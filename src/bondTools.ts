import * as THREE from 'three';
import { Atom } from './molecularData.js';
import type { Bond } from './molecularData.js';
import { molecule, simulationSpace, BOND_SCALE, simulationToWorldSpace } from './state.js';
import { getSelectedBondOrder, getSelectedBuildMode, setPresetStatus } from './elementSelector.js';
import { calculateGuidelines } from './guidelines.js';
import { atomGroup, rebuildVisuals } from './visuals/moleculeView.js';
import { guideValidMat, renderGhostAtomHighlight, renderGhostBond, renderGuidelineSet } from './visuals/ghostView.js';

interface BondPlacementCandidate {
    atomA: Atom;
    atomB: Atom;
    existingBond: Bond | null;
    order: number;
}

let selectedBondAtom: Atom | null = null;

const controllerRaycaster = new THREE.Raycaster();
const controllerRayRotation = new THREE.Matrix4();

export function placeBondAtPosition(controller: THREE.XRTargetRaySpace): void {
    const hoveredAtom = findBondSelectionAtom(controller);
    if (!hoveredAtom) {
        clearBondPlacementSelection();
        return;
    }

    const sourceAtom = getSelectedBondAtom();
    if (!sourceAtom) {
        selectedBondAtom = hoveredAtom;
        setPresetStatus('First atom selected; choose second atom');
        return;
    }

    if (hoveredAtom === sourceAtom) {
        clearBondPlacementSelection();
        return;
    }

    const candidate = buildBondPlacementCandidate(sourceAtom, hoveredAtom);
    if (!candidate) {
        if (molecule.getBondBetween(sourceAtom, hoveredAtom)?.order === getSelectedBondOrder()) {
            setPresetStatus('Those atoms already use the selected bond order');
        } else {
            setPresetStatus('Cannot create the selected bond between those atoms');
        }
        return;
    }

    if (!molecule.setBondOrder(candidate.atomA, candidate.atomB, candidate.order)) {
        setPresetStatus('Cannot create the selected bond between those atoms');
        return;
    }

    clearBondPlacementSelection();
    rebuildVisuals();
}

export function updateBondGhostPreview(controller: THREE.XRTargetRaySpace): void {
    const hoveredAtom = findBondSelectionAtom(controller);
    const sourceAtom = getSelectedBondAtom();

    if (!sourceAtom) {
        if (hoveredAtom) {
            renderGhostAtomHighlight(hoveredAtom);
        }
        return;
    }

    renderGhostAtomHighlight(sourceAtom);

    if (!hoveredAtom || hoveredAtom === sourceAtom) {
        return;
    }

    renderGhostAtomHighlight(hoveredAtom);

    const candidate = findBondPlacementCandidate(hoveredAtom);
    if (!candidate) return;

    renderBondPlacementGuidelines(candidate);
    renderGhostBond(
        simulationToWorldSpace(candidate.atomA.position),
        simulationToWorldSpace(candidate.atomB.position),
        candidate.atomA.color,
        candidate.atomB.color,
        Math.max(candidate.atomA.scale, candidate.atomB.scale) * BOND_SCALE * simulationSpace.scale.x,
        candidate.order,
    );
}

export function clearBondPlacementSelection(updateStatus: boolean = true): void {
    selectedBondAtom = null;
    if (updateStatus && getSelectedBuildMode() === 'bond') {
        setPresetStatus('Bond editing ready');
    }
}

function getSelectedBondAtom(): Atom | null {
    if (selectedBondAtom && !molecule.atoms.includes(selectedBondAtom)) {
        selectedBondAtom = null;
    }
    return selectedBondAtom;
}

function findBondPlacementCandidate(targetAtom: Atom | null): BondPlacementCandidate | null {
    const sourceAtom = getSelectedBondAtom();
    if (!sourceAtom || !targetAtom || targetAtom === sourceAtom) {
        return null;
    }
    return buildBondPlacementCandidate(sourceAtom, targetAtom);
}

function buildBondPlacementCandidate(atomA: Atom, atomB: Atom): BondPlacementCandidate | null {
    const desiredOrder = getSelectedBondOrder();
    const existingBond = molecule.getBondBetween(atomA, atomB);
    if (existingBond?.order === desiredOrder) {
        return null;
    }
    if (!molecule.canSetBondOrder(atomA, atomB, desiredOrder)) {
        return null;
    }
    return { atomA, atomB, existingBond, order: desiredOrder };
}

function findBondSelectionAtom(controller: THREE.XRTargetRaySpace): Atom | null {
    controller.updateMatrixWorld(true);
    atomGroup.updateMatrixWorld(true);

    controllerRayRotation.identity().extractRotation(controller.matrixWorld);
    controllerRaycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    controllerRaycaster.ray.direction.set(0, 0, -1).applyMatrix4(controllerRayRotation).normalize();

    for (const intersection of controllerRaycaster.intersectObjects(atomGroup.children, false)) {
        if (intersection.object.userData.atom instanceof Atom) {
            return intersection.object.userData.atom;
        }
    }
    return null;
}

function renderBondPlacementGuidelines(candidate: BondPlacementCandidate): void {
    const guidelineSets = [
        ...calculateGuidelines([candidate.atomA], candidate.atomB.element, candidate.atomB.position, candidate.order),
        ...calculateGuidelines([candidate.atomB], candidate.atomA.element, candidate.atomA.position, candidate.order),
    ];

    for (const gd of guidelineSets) {
        renderGuidelineSet(gd, guideValidMat);
    }
}
