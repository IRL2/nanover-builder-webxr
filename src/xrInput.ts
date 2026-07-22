import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { scene, renderer } from './scene.js';
import { simulationSpace, worldToSimulationSpace } from './state.js';
import { createElementSelector } from './elementSelector.js';

export let controller1: THREE.XRTargetRaySpace;
export let controller2: THREE.XRTargetRaySpace;

export function setupXRControllers(onSelectionChange: () => void): void {
    controller1 = renderer.xr.getController(0);
    controller1.userData.id = 0;
    scene.add(controller1);

    controller2 = renderer.xr.getController(1);
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

    createElementSelector(controller2, renderer, onSelectionChange);
}

export function getControllerWorldPos(controller: THREE.XRTargetRaySpace): THREE.Vector3 | null {
    const pivot = controller.getObjectByName('pivot');
    if (!pivot) return null;
    return new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld);
}

export function getControllerSimulationMatrix(controller: THREE.XRTargetRaySpace): THREE.Matrix4 | null {
    const pivot = controller.getObjectByName('pivot');
    if (!pivot) return null;

    simulationSpace.updateMatrixWorld(true);
    pivot.updateMatrixWorld(true);

    const worldPosition = new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld);
    const simulationPosition = worldToSimulationSpace(worldPosition);
    const pivotWorldQuaternion = pivot.getWorldQuaternion(new THREE.Quaternion());
    const simulationWorldQuaternion = simulationSpace.getWorldQuaternion(new THREE.Quaternion());
    const simulationQuaternion = simulationWorldQuaternion.invert().multiply(pivotWorldQuaternion);

    return new THREE.Matrix4().compose(
        simulationPosition,
        simulationQuaternion,
        new THREE.Vector3(1, 1, 1),
    );
}
