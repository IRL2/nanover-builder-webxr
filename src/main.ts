import './style.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { downloadPDB } from './exportPDB.js';
import { getSelectedBuildMode, updateElementSelector } from './elementSelector.js';
import { scene, camera, renderer, setupScene } from './scene.js';
import { molecule, simulationSpace } from './state.js';
import { controller1, controller2, setupXRControllers, getControllerWorldPos } from './xrInput.js';
import { checkStartTwoHandGesture, endTwoHandGesture, updateTwoHandGesture } from './gestures.js';
import { placeAtom, updateAtomGhostPreview } from './atomTools.js';
import { placeBondAtPosition, updateBondGhostPreview, clearBondPlacementSelection } from './bondTools.js';
import { removeAtomAtPosition, removeBondAtPosition, updateDeleteHighlight, deleteHighlightGroup } from './deletion.js';
import { setupPresetLibrary, refreshSelectedFragment, placeSelectedFragment, updateFragmentGhostPreview } from './fragmentTools.js';
import {
    gizmoGroup,
    handleRotationSelectStart,
    handleRotationSelectEnd,
    updateRotationDrag,
    isRotationDragging,
    updateRotationPreview,
    clearRotationSelection,
} from './rotationTools.js';
import { atomGroup, bondGroup } from './visuals/moleculeView.js';
import { ghostGroup, guidelineGroup } from './visuals/ghostView.js';

init();

function init(): void {
    setupScene();

    simulationSpace.add(atomGroup);
    simulationSpace.add(bondGroup);
    simulationSpace.add(deleteHighlightGroup);
    simulationSpace.add(gizmoGroup);
    scene.add(simulationSpace);
    scene.add(ghostGroup);
    scene.add(guidelineGroup);

    setupXRControllers(() => {
        clearBondPlacementSelection(false);
        clearRotationSelection();
        ghostGroup.clear();
        guidelineGroup.clear();
        deleteHighlightGroup.clear();
        void refreshSelectedFragment();
    });

    wireControllerEvents();

    const gui = new GUI();
    gui.add({ exportPDB: () => downloadPDB(molecule) }, 'exportPDB').name('Export PDB');

    renderer.setAnimationLoop(animate);

    void setupPresetLibrary();
}

function wireControllerEvents(): void {
    function onSelectStart(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = true;
        if (getSelectedBuildMode() === 'rotate' && this.userData.id === 0) {
            handleRotationSelectStart(this);
        }
    }

    function onSelectEnd(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        const mode = getSelectedBuildMode();
        const worldPos = this.userData.lastWorldPos as THREE.Vector3 | undefined;

        if (mode === 'rotate') {
            if (this.userData.id === 0) {
                handleRotationSelectEnd(this);
            }
            return;
        }

        if (mode === 'preset') {
            placeSelectedFragment(this);
        } else if (mode === 'bond') {
            placeBondAtPosition(this);
        } else {
            placeAtom(worldPos);
        }
    }

    function onSelectEndRight(this: THREE.XRTargetRaySpace) {
        this.userData.isSelecting = false;
        const mode = getSelectedBuildMode();
        if (mode === 'rotate') return;

        const worldPos = this.userData.lastWorldPos as THREE.Vector3 | undefined;
        if (worldPos) {
            if (mode === 'bond') {
                removeBondAtPosition(worldPos);
            } else {
                removeAtomAtPosition(worldPos);
            }
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

    controller1.addEventListener('selectstart', onSelectStart);
    controller1.addEventListener('selectend', onSelectEnd);
    controller1.addEventListener('squeezestart', onSqueezeStart);
    controller1.addEventListener('squeezeend', onSqueezeEnd);

    controller2.addEventListener('selectstart', onSelectStart);
    controller2.addEventListener('selectend', onSelectEndRight);
    controller2.addEventListener('squeezestart', onSqueezeStart);
    controller2.addEventListener('squeezeend', onSqueezeEnd);
}

let prevTime = 0;

function animate(_timestamp: DOMHighResTimeStamp, frame?: XRFrame): void {
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
            if (session && ctrl === controller1) {
                if (isRotationDragging()) {
                    updateRotationDrag(ctrl);
                } else {
                    updateGhostPreviewDispatch(ctrl);
                }
            }
            if (session && ctrl === controller2) updateDeleteHighlight(pos);
        }
    }
    if (!session) {
        ghostGroup.clear();
        guidelineGroup.clear();
        deleteHighlightGroup.clear();
        clearRotationSelection();
    }

    renderer.render(scene, camera);
}

function updateGhostPreviewDispatch(controller: THREE.XRTargetRaySpace): void {
    ghostGroup.clear();
    guidelineGroup.clear();

    const mode = getSelectedBuildMode();
    if (mode === 'preset') {
        updateFragmentGhostPreview(controller);
    } else if (mode === 'bond') {
        updateBondGhostPreview(controller);
    } else if (mode === 'rotate') {
        updateRotationPreview(controller);
    } else {
        updateAtomGhostPreview(controller);
    }
}
