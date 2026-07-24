import * as THREE from 'three';
import { Atom, Bond } from '../core/molecularData.js';
import { simulationSpace, worldToSimulationSpace, simulationToWorldSpace, BOND_SCALE } from '../state.js';
import { getControllerWorldPos } from '../xr/xrInput.js';
import { getSelectedBuildMode, setPresetStatus } from '../ui/elementSelector.js';
import { rebuildVisuals, atomGroup, bondGroup } from '../visuals/moleculeView.js';
import { ghostGroup, guidelineGroup, renderGhostAtomHighlight, ghostMaterial } from '../visuals/ghostView.js';

const GIZMO_RING_RADIUS = 0.12;
const GIZMO_TUBE_RADIUS = 0.008;

export const gizmoGroup = new THREE.Group();

const ringGeometry = new THREE.TorusGeometry(GIZMO_RING_RADIUS, GIZMO_TUBE_RADIUS, 16, 48);
const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffcc33,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
    depthWrite: false,
});
const gizmoRing = new THREE.Mesh(ringGeometry, ringMaterial);
gizmoRing.renderOrder = 999;
gizmoGroup.add(gizmoRing);
gizmoGroup.visible = false;

type Phase = 'idle' | 'awaiting-bond' | 'ready';

let phase: Phase = 'idle';
let selectedAtom: Atom | null = null;
let branchAtoms: Atom[] = [];
let bondAxis: THREE.Vector3 | null = null;

let isDragging = false;
let dragStartControllerSimPos: THREE.Vector3 | null = null;
let initialPositions: Map<Atom, THREE.Vector3> = new Map();

const raycaster = new THREE.Raycaster();
const rayRotation = new THREE.Matrix4();

function getControllerRay(controller: THREE.XRTargetRaySpace): THREE.Raycaster {
    controller.updateMatrixWorld(true);
    rayRotation.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayRotation).normalize();
    return raycaster;
}

function findHoveredAtom(controller: THREE.XRTargetRaySpace): Atom | null {
    simulationSpace.updateMatrixWorld(true);
    atomGroup.updateMatrixWorld(true);
    const ray = getControllerRay(controller);
    for (const intersection of ray.intersectObjects(atomGroup.children, false)) {
        if (intersection.object.userData.atom instanceof Atom) {
            return intersection.object.userData.atom;
        }
    }
    return null;
}

function findHoveredBond(controller: THREE.XRTargetRaySpace): Bond | null {
    simulationSpace.updateMatrixWorld(true);
    bondGroup.updateMatrixWorld(true);
    const ray = getControllerRay(controller);
    for (const intersection of ray.intersectObjects(bondGroup.children, false)) {
        const bond = intersection.object.userData.bond;
        if (bond instanceof Bond) return bond;
    }
    return null;
}

function findHoveredRing(controller: THREE.XRTargetRaySpace): boolean {
    simulationSpace.updateMatrixWorld(true);
    gizmoGroup.updateMatrixWorld(true);
    const ray = getControllerRay(controller);
    return ray.intersectObject(gizmoRing, false).length > 0;
}

function findBranch(branchHead: Atom, fixedNeighbor: Atom): Atom[] {
    const visited = new Set<Atom>([branchHead]);
    const queue: Atom[] = [branchHead];
    const result: Atom[] = [branchHead];

    while (queue.length > 0) {
        const atom = queue.shift()!;
        for (const bonded of atom.bondedAtoms) {
            if (visited.has(bonded)) continue;
            if (atom === branchHead && bonded === fixedNeighbor) continue;
            visited.add(bonded);
            queue.push(bonded);
            result.push(bonded);
        }
    }

    return result;
}

function setGizmoToBond(atom: Atom, neighbor: Atom): void {
    const axis = neighbor.position.clone().sub(atom.position);
    const len = axis.length();
    if (len < 1e-9) {
        gizmoGroup.visible = false;
        return;
    }
    bondAxis = axis.normalize();
    gizmoGroup.position.copy(atom.position);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), bondAxis);
    gizmoGroup.quaternion.copy(q);
    gizmoGroup.visible = true;
}

function selectAtom(atom: Atom): void {
    selectedAtom = atom;
    branchAtoms = [];
    bondAxis = null;
    gizmoGroup.visible = false;

    if (atom.bonds.length === 1) {
        const bond = atom.bonds[0];
        const neighbor = bond.a === atom ? bond.b : bond.a;
        branchAtoms = findBranch(atom, neighbor);
        setGizmoToBond(atom, neighbor);
        phase = 'ready';
        setPresetStatus('Grab the ring to rotate the branch');
    } else if (atom.bonds.length === 0) {
        phase = 'idle';
        setPresetStatus('Atom has no bonds — pick another');
        selectedAtom = null;
    } else {
        phase = 'awaiting-bond';
        setPresetStatus('Pick one of the atom\'s bonds as the axis');
    }
}

function selectBond(bond: Bond): void {
    if (!selectedAtom) return;
    const neighbor = bond.a === selectedAtom ? bond.b : bond.a;
    branchAtoms = findBranch(selectedAtom, neighbor);
    setGizmoToBond(selectedAtom, neighbor);
    phase = 'ready';
    setPresetStatus('Grab the ring to rotate the branch');
}

export function clearRotationSelection(): void {
    phase = 'idle';
    selectedAtom = null;
    branchAtoms = [];
    bondAxis = null;
    isDragging = false;
    dragStartControllerSimPos = null;
    initialPositions = new Map();
    gizmoGroup.visible = false;
    ringMaterial.opacity = 0.6;
    if (getSelectedBuildMode() === 'rotate') {
        setPresetStatus('Point at an atom to select');
    }
}

export function isRotationDragging(): boolean {
    return isDragging;
}

export function handleRotationSelectStart(controller: THREE.XRTargetRaySpace): void {
    if (phase !== 'ready' || isDragging) return;
    if (!findHoveredRing(controller)) return;

    const worldPos = getControllerWorldPos(controller);
    if (!worldPos) return;

    isDragging = true;
    dragStartControllerSimPos = worldToSimulationSpace(worldPos);
    initialPositions = new Map();
    for (const atom of branchAtoms) {
        initialPositions.set(atom, atom.position.clone());
    }
    ringMaterial.opacity = 1.0;
    ghostGroup.clear();
    guidelineGroup.clear();
    setPresetStatus('Rotating branch — release to commit');
}

export function handleRotationSelectEnd(controller: THREE.XRTargetRaySpace): void {
    if (isDragging) {
        isDragging = false;
        dragStartControllerSimPos = null;
        initialPositions = new Map();
        ringMaterial.opacity = 0.6;
        setPresetStatus('Rotation committed — grab the ring or pick another atom');
        return;
    }

    if (phase === 'awaiting-bond') {
        const bond = findHoveredBond(controller);
        if (bond && selectedAtom && selectedAtom.bonds.includes(bond)) {
            selectBond(bond);
            return;
        }
        clearRotationSelection();
        return;
    }

    const hovered = findHoveredAtom(controller);
    if (hovered) {
        if (hovered === selectedAtom) {
            clearRotationSelection();
        } else {
            selectAtom(hovered);
        }
        return;
    }

    clearRotationSelection();
}

export function updateRotationDrag(controller: THREE.XRTargetRaySpace): void {
    if (!isDragging || !selectedAtom || !bondAxis || !dragStartControllerSimPos) return;

    const worldPos = getControllerWorldPos(controller);
    if (!worldPos) return;

    const currentSimPos = worldToSimulationSpace(worldPos);
    const pivot = selectedAtom.position;

    const v0 = dragStartControllerSimPos.clone().sub(pivot);
    const v1 = currentSimPos.clone().sub(pivot);

    v0.sub(bondAxis.clone().multiplyScalar(v0.dot(bondAxis)));
    v1.sub(bondAxis.clone().multiplyScalar(v1.dot(bondAxis)));

    if (v0.lengthSq() < 1e-10 || v1.lengthSq() < 1e-10) return;

    const cross = new THREE.Vector3().crossVectors(v0, v1);
    const dot = v0.dot(v1);
    const angle = Math.atan2(cross.dot(bondAxis), dot);

    const quat = new THREE.Quaternion().setFromAxisAngle(bondAxis, angle);

    for (const atom of branchAtoms) {
        const initialPos = initialPositions.get(atom);
        if (!initialPos) continue;
        const offset = initialPos.clone().sub(pivot);
        offset.applyQuaternion(quat);
        atom.position.copy(pivot).add(offset);
    }

    rebuildVisuals();
    gizmoGroup.position.copy(selectedAtom.position);
}

export function updateRotationPreview(controller: THREE.XRTargetRaySpace): void {
    ghostGroup.clear();
    guidelineGroup.clear();

    if (isDragging) return;

    ringMaterial.opacity = 0.6;

    if (phase === 'idle') {
        const hovered = findHoveredAtom(controller);
        if (hovered) renderGhostAtomHighlight(hovered);
        return;
    }

    if (phase === 'awaiting-bond' && selectedAtom) {
        renderGhostAtomHighlight(selectedAtom);
        const hoveredBond = findHoveredBond(controller);
        if (hoveredBond && selectedAtom.bonds.includes(hoveredBond)) {
            highlightBond(hoveredBond);
        }
        return;
    }

    if (phase === 'ready') {
        if (findHoveredRing(controller)) {
            ringMaterial.opacity = 1.0;
        }
        const hovered = findHoveredAtom(controller);
        if (hovered && hovered !== selectedAtom) {
            renderGhostAtomHighlight(hovered);
        }
    }
}

function highlightBond(bond: Bond): void {
    if (!selectedAtom) return;
    const neighbor = bond.a === selectedAtom ? bond.b : bond.a;
    const start = simulationToWorldSpace(selectedAtom.position);
    const end = simulationToWorldSpace(neighbor.position);
    const mat = ghostMaterial.clone();
    mat.color = new THREE.Color(0xffcc33);
    const geom = new THREE.CylinderGeometry(1, 1, 1, 8);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    const radius = Math.max(selectedAtom.scale, neighbor.scale) * BOND_SCALE * 1.5;
    const cyl = new THREE.Mesh(geom, mat);
    cyl.position.copy(mid);
    cyl.scale.set(radius, len, radius);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    ghostGroup.add(cyl);
}
