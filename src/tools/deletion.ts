import * as THREE from 'three';
import type { Atom, Bond } from '../core/molecularData.js';
import { molecule, atomGeometry, BOND_SCALE, BOND_SELECTION_MARGIN, worldToSimulationSpace } from '../state.js';
import { findNearestAtom, distanceToSegment } from '../core/hitChecks.js';
import { getSelectedBuildMode } from '../ui/elementSelector.js';
import { buildBondSegments, getBondHitRadius } from '../visuals/bondMesh.js';
import { rebuildVisuals } from '../visuals/moleculeView.js';

export const deleteHighlightGroup = new THREE.Group();

const deleteHighlightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, transparent: true, opacity: 0.6, depthWrite: false });

export function removeAtomAtPosition(worldPos: THREE.Vector3 | undefined): void {
    if (!worldPos) return;

    const simPos = worldToSimulationSpace(worldPos);
    const atom = findNearestAtom(simPos, molecule.atoms, 0.08);
    if (atom) {
        molecule.removeAtom(atom);
        rebuildVisuals();
    }
}

export function removeBondAtPosition(worldPos: THREE.Vector3 | undefined): void {
    if (!worldPos) return;

    const simPos = worldToSimulationSpace(worldPos);
    const bond = findBondDeletionCandidate(simPos);
    if (!bond) return;

    molecule.removeBond(bond);
    molecule.reindex();
    rebuildVisuals();
}

export function updateDeleteHighlight(cursorPos: THREE.Vector3 | null): void {
    deleteHighlightGroup.clear();

    if (!cursorPos) return;

    const mode = getSelectedBuildMode();
    if (mode === 'rotate') return;

    if (mode === 'bond') {
        updateBondDeleteHighlight(cursorPos);
        return;
    }

    updateAtomDeleteHighlight(cursorPos);
}

function updateAtomDeleteHighlight(cursorPos: THREE.Vector3): void {
    const simPos = worldToSimulationSpace(cursorPos);
    const atom = findNearestAtom(simPos, molecule.atoms, 0.08);
    if (!atom) return;

    renderDeleteAtomHighlight(atom);

    for (const bond of atom.bonds) {
        const other = bond.a === atom ? bond.b : bond.a;
        buildBondSegments(
            deleteHighlightGroup,
            atom.position,
            other.position,
            Math.max(atom.scale, other.scale) * BOND_SCALE * 1.3,
            bond.order,
            deleteHighlightMat,
        );
    }
}

function updateBondDeleteHighlight(cursorPos: THREE.Vector3): void {
    const simPos = worldToSimulationSpace(cursorPos);
    const bond = findBondDeletionCandidate(simPos);
    if (!bond) return;

    renderDeleteAtomHighlight(bond.a);
    renderDeleteAtomHighlight(bond.b);
    buildBondSegments(
        deleteHighlightGroup,
        bond.a.position,
        bond.b.position,
        Math.max(bond.a.scale, bond.b.scale) * BOND_SCALE * 1.3,
        bond.order,
        deleteHighlightMat,
    );
}

function renderDeleteAtomHighlight(atom: Atom): void {
    const highlightMesh = new THREE.Mesh(atomGeometry, deleteHighlightMat);
    highlightMesh.position.copy(atom.position);
    highlightMesh.scale.setScalar(atom.scale / 2 * 1.3);
    deleteHighlightGroup.add(highlightMesh);
}

function findBondDeletionCandidate(cursorPos: THREE.Vector3): Bond | null {
    let bestBond: Bond | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const bond of molecule.bonds) {
        const score = getBondSelectionScore(cursorPos, bond.a, bond.b, bond.order);
        if (score === null || score >= bestScore) continue;
        bestBond = bond;
        bestScore = score;
    }
    return bestBond;
}

function getBondSelectionScore(
    cursorPos: THREE.Vector3,
    atomA: Atom,
    atomB: Atom,
    visibleOrder: number,
): number | null {
    const baseBondRadius = Math.max(atomA.scale, atomB.scale) * BOND_SCALE;
    const maxDistance = getBondHitRadius(baseBondRadius, visibleOrder) + BOND_SELECTION_MARGIN;
    const distance = distanceToSegment(cursorPos, atomA.position, atomB.position);
    if (distance > maxDistance) return null;

    const midpointDistance = atomA.position.clone().add(atomB.position).multiplyScalar(0.5).distanceTo(cursorPos);
    return distance * 2 + midpointDistance * 0.25;
}
