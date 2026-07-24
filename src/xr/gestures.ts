import * as THREE from 'three';
import { simulationSpace } from '../state.js';
import { controller1, controller2, getControllerWorldPos } from './xrInput.js';

interface SqueezeGestureState {
    active: boolean;
    initialDistance: number;
    initialMidpoint: THREE.Vector3;
    initialControllerDir: THREE.Vector3;
    initialSimulationSpaceMatrix: THREE.Matrix4;
}

const squeezeState: SqueezeGestureState = {
    active: false,
    initialDistance: 0,
    initialMidpoint: new THREE.Vector3(),
    initialControllerDir: new THREE.Vector3(),
    initialSimulationSpaceMatrix: new THREE.Matrix4(),
};

export function checkStartTwoHandGesture(): void {
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

export function endTwoHandGesture(): void {
    squeezeState.active = false;
}

export function updateTwoHandGesture(): void {
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
