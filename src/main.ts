import './style.css';
import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { Atom, MolecularStructure } from './molecularData.js';
import { calculateGuidelines, emptyBondNumber } from './guidelines.js';
import type { GuidelineData } from './guidelines.js';
import { biasedSortedBondOverlapForNew, sortedPositionsByDistance } from './hitChecks.js';
import { createElementSelector, getSelectedElement, updateElementSelector } from './elementSelector.js';

// --- STATE ---

const molecule = new MolecularStructure();

// Three.js objects
let container: HTMLDivElement;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let renderer: THREE.WebGLRenderer;
let controller1: THREE.XRTargetRaySpace;
let controller2: THREE.XRTargetRaySpace;

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

    document.body.appendChild(XRButton.createButton(renderer));

    scene.add(atomGroup);
    scene.add(bondGroup);
    scene.add(ghostGroup);
    scene.add(guidelineGroup);

    setupXRControllers();

    window.addEventListener('resize', onWindowResize);
}

// --- XR CONTROLLERS ---

function setupXRControllers() {
    function onSelectStart(this: THREE.XRTargetRaySpace) { this.userData.isSelecting = true; }
    function onSelectEnd(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        placeAtom(this.userData.lastWorldPos as THREE.Vector3);
    }

    function onSelectStartRight(this: THREE.XRTargetRaySpace) { this.userData.isSelecting = true; }
    function onSelectEndRight(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        // TODO: right trigger delete action under cursor
    }

    controller1 = renderer.xr.getController(0);
    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    controller1.userData.id = 0;
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
    controller2.addEventListener('selectstart', onSelectStartRight);
    controller2.addEventListener('selectend', onSelectEndRight);
    controller2.userData.id = 1;
    scene.add(controller2);

    const pivot = new THREE.Mesh(new THREE.IcosahedronGeometry(0.01, 3));
    pivot.name = 'pivot';
    pivot.position.z = -0.05;

    const group = new THREE.Group();
    group.add(pivot);
    controller1.add(group.clone());
    controller2.add(group.clone());

    const modelFactory = new XRControllerModelFactory();

    const grip1 = renderer.xr.getControllerGrip(0);
    grip1.add(modelFactory.createControllerModel(grip1));
    scene.add(grip1);

    const grip2 = renderer.xr.getControllerGrip(1);
    grip2.add(modelFactory.createControllerModel(grip2));
    scene.add(grip2);

    createElementSelector(controller2, renderer);
}

// --- ELEMENT PLACEMENT ---

function placeAtom(worldPos: THREE.Vector3) {
    if (!worldPos) return;

    const el = getSelectedElement();
    const nearby = biasedSortedBondOverlapForNew(el, worldPos, molecule.atoms);

    let finalPos = worldPos.clone();
    if (nearby.length > 0) {
        finalPos = snapToGuideline(el, worldPos, nearby);
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

    const el = getSelectedElement();
    const nearby = biasedSortedBondOverlapForNew(el, cursorPos, molecule.atoms);
    let ghostPos = cursorPos.clone();
    let guidelines: GuidelineData[] = [];

    if (nearby.length > 0) {
        guidelines = calculateGuidelines(nearby, el, cursorPos);
        ghostPos = snapToGuideline(el, cursorPos, nearby);
    }

    // ghost atom sphere
    const tempAtom = new Atom(el, ghostPos);
    const ghostColor = new THREE.Color(tempAtom.color);
    const ghostMat = ghostMaterial.clone();
    ghostMat.color = ghostColor;
    const ghostMesh = new THREE.Mesh(atomGeometry, ghostMat);
    ghostMesh.position.copy(ghostPos);
    ghostMesh.scale.setScalar(tempAtom.scale / 2);
    ghostGroup.add(ghostMesh);

    // ghost bonds
    for (const target of nearby) {
        if (target.emptyBonds <= 0) continue;
        const start = ghostPos;
        const end = target.position;
        const mid = start.clone().add(end).multiplyScalar(0.5);
        const dir = end.clone().sub(start);
        const len = dir.length();
        const bondRadius = Math.max(tempAtom.scale, target.scale) * BOND_SCALE;

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
        const guideRadius = gd.core.scale * BOND_SCALE * 0.8;
        for (const pos of gd.positions) {
            const sphere = new THREE.Mesh(guidelineGeometry, mat);
            sphere.position.copy(pos);
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

    for (const ctrl of [controller1, controller2]) {
        const pos = getControllerWorldPos(ctrl);
        if (pos) {
            ctrl.userData.lastWorldPos = pos;
            if (ctrl === controller1) updateGhostPreview(pos);
        }
    }

    renderer.render(scene, camera);
}