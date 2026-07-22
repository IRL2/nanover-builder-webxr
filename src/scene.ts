import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

export const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 50);
camera.position.set(0, 1.6, 3);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;

export const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.update();

const grid = new THREE.GridHelper(4, 10, 0x333333, 0x222222);
scene.add(grid);

const light = new THREE.HemisphereLight(0xffffff, 0x888888, 3);
light.position.set(0, 6, 0);
scene.add(light);

export function setupScene(): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    container.appendChild(renderer.domElement);
    document.body.appendChild(XRButton.createButton(renderer));
    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
