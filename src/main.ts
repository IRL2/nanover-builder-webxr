import './style.css';
import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Atom, MolecularStructure } from './molecularData.js';
import { calculateGuidelines, emptyBondNumber } from './guidelines.js';
import type { GuidelineData } from './guidelines.js';
import { biasedSortedBondOverlapForNew, sortedPositionsByDistance, findNearestAtom } from './hitChecks.js';
import { createElementSelector, getSelectedElement, updateElementSelector } from './elementSelector.js';
import { downloadPDB } from './exportPDB.js';
import GUI from 'lil-gui';

// --- STATE ---

const molecule = new MolecularStructure();

// Three.js objects
let container: HTMLDivElement;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller1: THREE.XRTargetRaySpace;
let controller2: THREE.XRTargetRaySpace;
let controls: OrbitControls;

// Groups for rendering
const atomGroup = new THREE.Group();
const bondGroup = new THREE.Group();
const ghostGroup = new THREE.Group();
const guidelineGroup = new THREE.Group();

const BOND_SCALE = 0.15; // bond radius relative to atom scale
const atomGeometry = new THREE.SphereGeometry(1, 24, 16);
const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
const guidelineGeometry = new THREE.SphereGeometry(1, 12, 8);
const ghostMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });
const guideValidMat = new THREE.MeshStandardMaterial({ color: 0x44ff44, transparent: true, opacity: 0.35, depthWrite: false });
const guideInvalidMat = new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.35, depthWrite: false });
const deleteHighlightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, transparent: true, opacity: 0.6, depthWrite: false });
const deleteHighlightGroup = new THREE.Group();
const simulationSpace = new THREE.Group();

interface SqueezeGestureState {
    active: boolean;
    initialDistance: number;
    initialMidpoint: THREE.Vector3;
    initialControllerDir: THREE.Vector3;
    initialSimulationSpaceMatrix: THREE.Matrix4;
}

init();

function init() {
    container = document.createElement('div');
    document.body.appendChild(container);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    // camera
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 50);
    camera.position.set(0, 1.6, 3);

    const grid = new THREE.GridHelper(4, 10, 0x333333, 0x222222);
    scene.add(grid);

    // lights
    // scene.add(new THREE.HemisphereLight(0x888877, 0x777788, 3));
    const light = new THREE.HemisphereLight( 0xffffff, 0x888888, 3 );
	light.position.set( 0, 6, 0 );
    scene.add(light);

    // renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setAnimationLoop(animate);
    renderer.xr.enabled = true;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.update();

    document.body.appendChild(XRButton.createButton(renderer));

    // simulation space hierarchy
    simulationSpace.add(atomGroup);
    simulationSpace.add(bondGroup);
    simulationSpace.add(deleteHighlightGroup);

    scene.add(simulationSpace);
    scene.add(ghostGroup);
    scene.add(guidelineGroup);

    setupXRControllers();

    window.addEventListener('resize', onWindowResize);

    // GUI
    const gui = new GUI();
    gui.add({ exportPDB: () => downloadPDB(molecule) }, 'exportPDB').name('Export PDB');
}

// --- XR CONTROLLERS ---
const squeezeState: SqueezeGestureState = {
    active: false,
    initialDistance: 0,
    initialMidpoint: new THREE.Vector3(),
    initialControllerDir: new THREE.Vector3(),
    initialSimulationSpaceMatrix: new THREE.Matrix4(),
};

function setupXRControllers() {
    function onSelectStart(this: THREE.XRTargetRaySpace) { this.userData.isSelecting = true; }
    function onSelectEnd(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        placeAtom(this.userData.lastWorldPos as THREE.Vector3);
    }

    function onSelectStartRight(this: THREE.XRTargetRaySpace) { this.userData.isSelecting = true; }
    function onSelectEndRight(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        const worldPos = this.userData.lastWorldPos as THREE.Vector3;
        if (worldPos) {
            removeAtomAtPosition(worldPos);
        }
    }

    function onSqueezeStart(this: THREE.XRTargetRaySpace) {
        this.userData.isSqueezing = true;
        checkStartTwoHandGesture();
    }
    function onSqueezeEnd(this: THREE.XRTargetRaySpace) {
        this.userData.isSqueezing = false;
        endTwoHandGesture();
    }

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('squeezestart', onSqueezeStart);
    controller1.addEventListener('squeezeend', onSqueezeEnd);
    controller1.userData.id = 0;
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStartRight);
    controller2.addEventListener('selectend', onSelectEndRight);
    controller2.addEventListener('squeezestart', onSqueezeStart);
    controller2.addEventListener('squeezeend', onSqueezeEnd);
    controller2.userData.id = 1;
    scene.add(controller2);

    const pivotGeom = new THREE.IcosahedronGeometry(0.01, 3);
    const pivotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    
    const pivot1 = new THREE.Mesh(pivotGeom, pivotMat);
    pivot1.name = 'pivot';
    pivot1.position.set(-0.02, 0, -0.1);
    controller1.add(pivot1);
    
    const pivot2 = new THREE.Mesh(pivotGeom, pivotMat);
    pivot2.name = 'pivot';
    pivot2.position.set(0.02, 0, -0.1);
    controller2.add(pivot2);

    const modelFactory = new XRControllerModelFactory();

    const grip1 = renderer.xr.getControllerGrip(0);
    grip1.add(modelFactory.createControllerModel(grip1));
    scene.add(grip1);

    const grip2 = renderer.xr.getControllerGrip(1);
    grip2.add(modelFactory.createControllerModel(grip2));
    scene.add(grip2);

    createElementSelector(controller2, renderer);
}

// --- TWO-HAND SQUEEZE GESTURE (Scale/Rotate) ---

function checkStartTwoHandGesture() {
    if (controller1.userData.isSqueezing && controller2.userData.isSqueezing) {
        const pos1 = getControllerWorldPos(controller1);
        const pos2 = getControllerWorldPos(controller2);
        if (!pos1 || !pos2) return;

        squeezeState.active = true;
        squeezeState.initialDistance = pos1.distanceTo(pos2);
        squeezeState.initialMidpoint = pos1.clone().add(pos2).multiplyScalar(0.5);
        squeezeState.initialControllerDir = pos2.clone().sub(pos1).normalize();
        squeezeState.initialSimulationSpaceMatrix = simulationSpace.matrix.clone();
    }
}

function endTwoHandGesture() {
    squeezeState.active = false;
}

function updateTwoHandGesture() {
    if (!squeezeState.active) return;

    const pos1 = getControllerWorldPos(controller1);
    const pos2 = getControllerWorldPos(controller2);
    if (!pos1 || !pos2) return;

    const currentDistance = pos1.distanceTo(pos2);
    const currentMidpoint = pos1.clone().add(pos2).multiplyScalar(0.5);
    const currentDir = pos2.clone().sub(pos1).normalize();

    const scaleFactor = squeezeState.initialDistance > 0.01
        ? currentDistance / squeezeState.initialDistance
        : 1;

    const rotationQuat = new THREE.Quaternion().setFromUnitVectors(
        squeezeState.initialControllerDir,
        currentDir
    );

    simulationSpace.matrix.copy(squeezeState.initialSimulationSpaceMatrix);
    simulationSpace.matrixAutoUpdate = false;

    const tempMatrix = new THREE.Matrix4();

    tempMatrix.makeTranslation(
        -squeezeState.initialMidpoint.x,
        -squeezeState.initialMidpoint.y,
        -squeezeState.initialMidpoint.z
    );
    simulationSpace.matrix.premultiply(tempMatrix);

    tempMatrix.makeScale(scaleFactor, scaleFactor, scaleFactor);
    simulationSpace.matrix.premultiply(tempMatrix);

    tempMatrix.makeRotationFromQuaternion(rotationQuat);
    simulationSpace.matrix.premultiply(tempMatrix);

    tempMatrix.makeTranslation(currentMidpoint.x, currentMidpoint.y, currentMidpoint.z);
    simulationSpace.matrix.premultiply(tempMatrix);

    simulationSpace.matrix.decompose(simulationSpace.position, simulationSpace.quaternion, simulationSpace.scale);
}

// --- ATOM REMOVAL ---

function removeAtomAtPosition(worldPos: THREE.Vector3) {
    const simPos = worldToSimulationSpace(worldPos);
    const atom = findNearestAtom(simPos, molecule.atoms, 0.08);
    if (atom) {
        molecule.removeAtom(atom);
        rebuildVisuals();
    }
}

function updateDeleteHighlight(cursorPos: THREE.Vector3 | null) {
    deleteHighlightGroup.clear();

    if (!cursorPos) return;

    const simPos = worldToSimulationSpace(cursorPos);
    const atom = findNearestAtom(simPos, molecule.atoms, 0.08);
    if (!atom) return;

    const highlightMesh = new THREE.Mesh(atomGeometry, deleteHighlightMat);
    highlightMesh.position.copy(atom.position);
    highlightMesh.scale.setScalar(atom.scale / 2 * 1.3);
    deleteHighlightGroup.add(highlightMesh);

    for (const bond of atom.bonds) {
        const other = bond.a === atom ? bond.b : bond.a;
        const start = atom.position;
        const end = other.position;
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const dir = end.clone().sub(start);
        const len = dir.length();
        const bondRadius = Math.max(atom.scale, other.scale) * BOND_SCALE * 1.3;

        const cyl = new THREE.Mesh(bondGeometry, deleteHighlightMat);
        cyl.position.copy(mid);
        cyl.scale.set(bondRadius, len, bondRadius);
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        deleteHighlightGroup.add(cyl);
    }
}

// --- ELEMENT PLACEMENT ---

function placeAtom(worldPos: THREE.Vector3) {
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

function snapToGuideline(element: string, cursorPos: THREE.Vector3, nearbyCores: Atom[]): THREE.Vector3 {
    const guidelines = calculateGuidelines(nearbyCores, element, cursorPos);
    const snapped = cursorPos.clone();

    for (const gd of guidelines) {
        if (gd.positions.length === 0) continue;

        const sorted = sortedPositionsByDistance(cursorPos, gd.positions);
        const closest = gd.positions[sorted[0]];
        const diff = closest.clone().sub(snapped);
        const dist = diff.length();
        // strong when close, weak when far
        const strength = 1 / Math.pow(1 + 4 * dist, 2);
        snapped.add(diff.multiplyScalar(strength));
    }
    return snapped;
}

function rebuildVisuals() {
    atomGroup.clear();
    bondGroup.clear();

    for (const atom of molecule.atoms) {
        const color = new THREE.Color(atom.color);
        const mat = new THREE.MeshPhongMaterial({ color });
        const mesh = new THREE.Mesh(atomGeometry, mat);
        mesh.position.copy(atom.position);
        mesh.scale.setScalar(atom.scale / 2);
        mesh.userData.atom = atom;
        atomGroup.add(mesh);
    }

    for (const bond of molecule.bonds) {
        const start = bond.a.position;
        const end = bond.b.position;
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const dir = end.clone().sub(start);
        const len = dir.length();
        const halfLen = len / 2;
        const bondRadius = Math.max(bond.a.scale, bond.b.scale) * BOND_SCALE;
        const orientation = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0), dir.clone().normalize()
        );

        const offsets = bondOrderOffsets(bond.order, dir, bondRadius);
        for (const offset of offsets) {

            const midA = start.clone().add(mid).multiplyScalar(0.5);
            const matA = new THREE.MeshStandardMaterial({ color: bond.a.color, roughness: 0.6, metalness: 0.1 });
            const meshA = new THREE.Mesh(bondGeometry, matA);
            meshA.position.copy(midA).add(offset);
            meshA.scale.set(bondRadius, halfLen, bondRadius);
            meshA.quaternion.copy(orientation);
            bondGroup.add(meshA);

            const midB = mid.clone().add(end).multiplyScalar(0.5);
            const matB = new THREE.MeshStandardMaterial({ color: bond.b.color, roughness: 0.6, metalness: 0.1 });
            const meshB = new THREE.Mesh(bondGeometry, matB);
            meshB.position.copy(midB).add(offset);
            meshB.scale.set(bondRadius, halfLen, bondRadius);
            meshB.quaternion.copy(orientation);
            bondGroup.add(meshB);
        }
    }
}

function bondOrderOffsets(order: number, dir: THREE.Vector3, bondRadius: number): THREE.Vector3[] {
    if (order === 1) return [new THREE.Vector3()];
    const perp = new THREE.Vector3();
    if (Math.abs(dir.x) < 0.9) perp.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    else perp.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const spacing = bondRadius * 2.5;
    if (order === 2) return [perp.clone().multiplyScalar(spacing), perp.clone().multiplyScalar(-spacing)];
    const perp2 = new THREE.Vector3().crossVectors(dir, perp).normalize();
    return [
        perp.clone().multiplyScalar(spacing),
        perp.clone().multiplyScalar(-spacing / 2).add(perp2.clone().multiplyScalar(spacing * 0.866)),
        perp.clone().multiplyScalar(-spacing / 2).add(perp2.clone().multiplyScalar(-spacing * 0.866)),
    ];
}

// --- GHOST PREVIEW ---

function updateGhostPreview(cursorPos: THREE.Vector3) {
    ghostGroup.clear();
    guidelineGroup.clear();

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

    // ghost bonds
    for (const target of nearby) {
        if (target.emptyBonds <= 0) continue;
        const start = ghostPos;
        const end = simulationToWorldSpace(target.position);
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const dir = end.clone().sub(start);
        const len = dir.length();
        const bondRadius = Math.max(tempAtom.scale, target.scale) * BOND_SCALE * simulationSpace.scale.x;

        const lineMat = ghostMaterial.clone();
        lineMat.color = ghostColor;
        const cyl = new THREE.Mesh(bondGeometry, lineMat);
        cyl.position.copy(mid);
        cyl.scale.set(bondRadius, len, bondRadius);
        cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        ghostGroup.add(cyl);
    }

    // guideline spheres
    for (const gd of guidelines) {
        const valid = emptyBondNumber(gd.core) > 0;
        const mat = valid ? guideValidMat : guideInvalidMat;
        const guideRadius = gd.core.scale * BOND_SCALE * 0.8 * simulationSpace.scale.x;
        for (const pos of gd.positions) {
            const sphere = new THREE.Mesh(guidelineGeometry, mat);
            sphere.position.copy(simulationToWorldSpace(pos));
            sphere.scale.setScalar(guideRadius);
            guidelineGroup.add(sphere);
        }
    }
}


function getControllerWorldPos(controller: THREE.XRTargetRaySpace): THREE.Vector3 | null {
    const pivot = controller.getObjectByName('pivot');
    if (!pivot) return null;
    return new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld);
}

// convert world position to simulation space 
const _inverseMatrix = new THREE.Matrix4();
function worldToSimulationSpace(worldPos: THREE.Vector3): THREE.Vector3 {
    simulationSpace.updateMatrixWorld(true);
    _inverseMatrix.copy(simulationSpace.matrixWorld).invert();
    return worldPos.clone().applyMatrix4(_inverseMatrix);
}

// convert simulation space position to world
function simulationToWorldSpace(simPos: THREE.Vector3): THREE.Vector3 {
    simulationSpace.updateMatrixWorld(true);
    return simPos.clone().applyMatrix4(simulationSpace.matrixWorld);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- MAIN ANIMATION LOOP ---

let prevTime = 0;

function animate(_timestamp: DOMHighResTimeStamp, frame?: XRFrame) {
    const now = performance.now();
    const delta = (now - prevTime) / 1000;
    prevTime = now;

    const session = frame?.session ?? renderer.xr.getSession();

    updateElementSelector(session, 1, delta);

    updateTwoHandGesture();

    for (const ctrl of [controller1, controller2]) {
        const pos = getControllerWorldPos(ctrl);
        if (pos) {
            ctrl.userData.lastWorldPos = pos;
            if (session && ctrl === controller1) updateGhostPreview(pos);
            if (session && ctrl === controller2) updateDeleteHighlight(pos);
        }
    }
    if (!session) {
        ghostGroup.clear();
        guidelineGroup.clear();
        deleteHighlightGroup.clear();
    }

    renderer.render(scene, camera);
}