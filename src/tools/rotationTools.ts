import * as THREE from 'three';
import { Atom, Bond } from '../core/molecularData.js';
import { simulationSpace, worldToSimulationSpace, simulationToWorldSpace, BOND_SCALE } from '../state.js';
import { getControllerWorldPos } from '../xr/xrInput.js';
import { getSelectedBuildMode, setPresetStatus } from '../ui/elementSelector.js';
import { rebuildVisuals, bondGroup } from '../visuals/moleculeView.js';
import { ghostGroup, guidelineGroup, ghostMaterial } from '../visuals/ghostView.js';

const GIZMO_RING_RADIUS = 0.12;
const GIZMO_TUBE_RADIUS = 0.008;

export const gizmoGroup = new THREE.Group();

function makeRing(color: number): THREE.Mesh {
    const geom = new THREE.TorusGeometry(GIZMO_RING_RADIUS, GIZMO_TUBE_RADIUS, 16, 48);
    const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(geom, mat);
    ring.renderOrder = 999;
    return ring;
}

const gizmoRingA = makeRing(0xffcc33);
const gizmoRingB = makeRing(0xffcc33);
gizmoGroup.add(gizmoRingA, gizmoRingB);
gizmoGroup.visible = false;

type Phase = 'idle' | 'ready';

let phase: Phase = 'idle';
let selectedBond: Bond | null = null;
let pivotAtom: Atom | null = null;
let branchAtoms: Atom[] = [];
let bondAxis: THREE.Vector3 | null = null;

let isDragging = false;
let dragStartControllerSimPos: THREE.Vector3 | null = null;
let initialPositions: Map<Atom, THREE.Vector3> = new Map();

const raycaster = new THREE.Raycaster();
const rayRotation = new THREE.Matrix4();

const UP = new THREE.Vector3(0, 0, 1);

function getControllerRay(controller: THREE.XRTargetRaySpace): THREE.Raycaster {
    controller.updateMatrixWorld(true);
    rayRotation.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayRotation).normalize();
    return raycaster;
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

function findHoveredRing(controller: THREE.XRTargetRaySpace): THREE.Mesh | null {
    if (!gizmoGroup.visible) return null;
    simulationSpace.updateMatrixWorld(true);
    gizmoGroup.updateMatrixWorld(true);
    const ray = getControllerRay(controller);
    const hits = ray.intersectObjects([gizmoRingA, gizmoRingB], false);
    return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
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

function placeRing(ring: THREE.Mesh, atom: Atom, neighbor: Atom): void {
    const axis = neighbor.position.clone().sub(atom.position);
    const len = axis.length();
    if (len < 1e-9) {
        ring.visible = false;
        return;
    }
    axis.normalize();
    ring.position.copy(atom.position);
    ring.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(UP, axis));
    ring.visible = true;
}

function setRingOpacity(opacity: number): void {
    (gizmoRingA.material as THREE.MeshBasicMaterial).opacity = opacity;
    (gizmoRingB.material as THREE.MeshBasicMaterial).opacity = opacity;
}

function selectBond(bond: Bond): void {
    selectedBond = bond;
    pivotAtom = null;
    branchAtoms = [];
    bondAxis = null;

    gizmoRingA.userData.atom = bond.a;
    gizmoRingB.userData.atom = bond.b;
    placeRing(gizmoRingA, bond.a, bond.b);
    placeRing(gizmoRingB, bond.b, bond.a);

    gizmoGroup.visible = true;
    setRingOpacity(0.6);
    phase = 'ready';
    setPresetStatus('Grab either ring to rotate that side');
}

export function clearRotationSelection(): void {
    phase = 'idle';
    selectedBond = null;
    pivotAtom = null;
    branchAtoms = [];
    bondAxis = null;
    isDragging = false;
    dragStartControllerSimPos = null;
    initialPositions = new Map();
    gizmoGroup.visible = false;
    setRingOpacity(0.6);
    if (getSelectedBuildMode() === 'rotate') {
        setPresetStatus('Point at a bond to select');
    }
}

export function isRotationDragging(): boolean {
    return isDragging;
}

export function handleRotationSelectStart(controller: THREE.XRTargetRaySpace): void {
    if (phase !== 'ready' || isDragging) return;
    const hoveredRing = findHoveredRing(controller);
    if (!hoveredRing) return;
    const atom = hoveredRing.userData.atom as Atom | undefined;
    const bond = selectedBond;
    if (!atom || !bond) return;

    const fixedNeighbor = bond.a === atom ? bond.b : bond.a;
    const axis = fixedNeighbor.position.clone().sub(atom.position);
    if (axis.lengthSq() < 1e-18) return;
    bondAxis = axis.normalize();
    pivotAtom = atom;
    branchAtoms = findBranch(atom, fixedNeighbor);

    const worldPos = getControllerWorldPos(controller);
    if (!worldPos) return;

    isDragging = true;
    dragStartControllerSimPos = worldToSimulationSpace(worldPos);
    initialPositions = new Map();
    for (const a of branchAtoms) {
        initialPositions.set(a, a.position.clone());
    }
    // Clear any lingering bond hover highlight so it doesn't persist through the drag.
    ghostGroup.clear();
    guidelineGroup.clear();
    // Only the grabbed ring goes full-bright; the other stays dim.
    setRingOpacity(0.25);
    (hoveredRing.material as THREE.MeshBasicMaterial).opacity = 1.0;
    setPresetStatus('Rotating branch — release to commit');
}

export function handleRotationSelectEnd(controller: THREE.XRTargetRaySpace): void {
    if (isDragging) {
        isDragging = false;
        dragStartControllerSimPos = null;
        initialPositions = new Map();
        setRingOpacity(0.6);
        if (selectedBond) {
            placeRing(gizmoRingA, selectedBond.a, selectedBond.b);
            placeRing(gizmoRingB, selectedBond.b, selectedBond.a);
        }
        setPresetStatus('Grab either ring to rotate that side');
        return;
    }

    const hoveredBond = findHoveredBond(controller);
    if (hoveredBond) {
        if (hoveredBond === selectedBond) {
            clearRotationSelection();
        } else {
            selectBond(hoveredBond);
        }
        return;
    }

    clearRotationSelection();
}

export function updateRotationDrag(controller: THREE.XRTargetRaySpace): void {
    if (!isDragging || !pivotAtom || !bondAxis || !dragStartControllerSimPos) return;

    const worldPos = getControllerWorldPos(controller);
    if (!worldPos) return;

    const currentSimPos = worldToSimulationSpace(worldPos);
    const pivot = pivotAtom.position;

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
}

export function updateRotationPreview(controller: THREE.XRTargetRaySpace): void {
    ghostGroup.clear();
    guidelineGroup.clear();

    if (isDragging) return;

    setRingOpacity(0.6);

    if (phase === 'idle') {
        const hoveredBond = findHoveredBond(controller);
        if (hoveredBond) highlightBond(hoveredBond);
        return;
    }

    if (phase === 'ready') {
        const hoveredRing = findHoveredRing(controller);
        if (hoveredRing) {
            (hoveredRing.material as THREE.MeshBasicMaterial).opacity = 1.0;
        }
        const hoveredBond = findHoveredBond(controller);
        if (hoveredBond && hoveredBond !== selectedBond) {
            highlightBond(hoveredBond);
        }
    }
}

function highlightBond(bond: Bond): void {
    const start = simulationToWorldSpace(bond.a.position);
    const end = simulationToWorldSpace(bond.b.position);
    const mat = ghostMaterial.clone();
    mat.color = new THREE.Color(0xffcc33);
    const geom = new THREE.CylinderGeometry(1, 1, 1, 8);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    if (len < 1e-9) return;
    const radius = Math.max(bond.a.scale, bond.b.scale) * BOND_SCALE * 1.5;
    const cyl = new THREE.Mesh(geom, mat);
    cyl.position.copy(mid);
    cyl.scale.set(radius, len, radius);
    cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    ghostGroup.add(cyl);
}

