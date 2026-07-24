import * as THREE from 'three';
import { Atom } from '../core/molecularData.js';
import { molecule, simulationSpace, atomGeometry, worldToSimulationSpace, simulationToWorldSpace, BOND_SCALE } from '../state.js';
import { calculateGuidelines, emptyBondNumber } from '../core/guidelines.js';
import type { GuidelineData } from '../core/guidelines.js';
import { biasedSortedBondOverlapForNew, sortedPositionsByDistance } from '../core/hitChecks.js';
import { getSelectedElement } from '../ui/elementSelector.js';
import { getControllerWorldPos } from '../xr/xrInput.js';
import { buildBondSegments } from '../visuals/bondMesh.js';
import { rebuildVisuals } from '../visuals/moleculeView.js';
import { ghostGroup, ghostMaterial, guideValidMat, guideInvalidMat, renderGuidelineSet } from '../visuals/ghostView.js';

export function placeAtom(worldPos: THREE.Vector3 | undefined): void {
    if (!worldPos) return;

    const simPos = worldToSimulationSpace(worldPos);
    const el = getSelectedElement();
    const nearby = biasedSortedBondOverlapForNew(el, simPos, molecule.atoms);

    let finalPos = simPos.clone();
    if (nearby.length > 0) {
        finalPos = snapToGuideline(el, simPos, nearby);
    }

    const newAtom = molecule.addAtom(el, finalPos);

    for (const target of nearby) {
        if (newAtom.emptyBonds <= 0) break;
        if (target.emptyBonds <= 0) continue;
        molecule.addBond(newAtom, target, 1);
    }

    rebuildVisuals();
}

export function updateAtomGhostPreview(controller: THREE.XRTargetRaySpace): void {
    const cursorPos = getControllerWorldPos(controller);
    if (!cursorPos) return;

    const simCursorPos = worldToSimulationSpace(cursorPos);

    const el = getSelectedElement();
    const nearby = biasedSortedBondOverlapForNew(el, simCursorPos, molecule.atoms);
    let ghostPos = cursorPos.clone();
    let guidelines: GuidelineData[] = [];

    if (nearby.length > 0) {
        guidelines = calculateGuidelines(nearby, el, simCursorPos);
        const snappedSimPos = snapToGuideline(el, simCursorPos, nearby);
        ghostPos = simulationToWorldSpace(snappedSimPos);
    }

    const tempAtom = new Atom(el, ghostPos);
    const ghostColor = new THREE.Color(tempAtom.color);
    const ghostMat = ghostMaterial.clone();
    ghostMat.color = ghostColor;
    const ghostMesh = new THREE.Mesh(atomGeometry, ghostMat);
    ghostMesh.position.copy(ghostPos);
    ghostMesh.scale.setScalar(tempAtom.scale / 2 * simulationSpace.scale.x);
    ghostGroup.add(ghostMesh);

    for (const target of nearby) {
        if (target.emptyBonds <= 0) continue;
        const lineMat = ghostMaterial.clone();
        lineMat.color = ghostColor;
        buildBondSegments(
            ghostGroup,
            ghostPos,
            simulationToWorldSpace(target.position),
            Math.max(tempAtom.scale, target.scale) * BOND_SCALE * simulationSpace.scale.x,
            1,
            lineMat,
        );
    }

    for (const gd of guidelines) {
        const valid = emptyBondNumber(gd.core) > 0;
        renderGuidelineSet(gd, valid ? guideValidMat : guideInvalidMat);
    }
}

export function snapToGuideline(element: string, cursorPos: THREE.Vector3, nearbyCores: Atom[]): THREE.Vector3 {
    const guidelines = calculateGuidelines(nearbyCores, element, cursorPos);
    const snapped = cursorPos.clone();

    for (const gd of guidelines) {
        if (gd.positions.length === 0) continue;

        const sorted = sortedPositionsByDistance(cursorPos, gd.positions);
        const closest = gd.positions[sorted[0]];
        const diff = closest.clone().sub(snapped);
        const dist = diff.length();
        const strength = 1 / Math.pow(1 + 4 * dist, 2);
        snapped.add(diff.multiplyScalar(strength));
    }
    return snapped;
}
