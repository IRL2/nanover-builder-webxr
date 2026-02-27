import { Container, Text, reversePainterSortStable } from '@pmndrs/uikit';
import * as THREE from 'three';
import { ELEMENTS } from './elementValues.js';

const elementKeys = Object.keys(ELEMENTS);
let selectedIndex = 0;
let rootContainer: Container | undefined;
let elementContainers: Container[] = [];
let labelText: Text | undefined;

let thumbstickCooldown = 0;
const COOLDOWN_TIME = 250;

// --- GUI ---
export function createElementSelector(
    controller: THREE.XRTargetRaySpace,
    renderer: THREE.WebGLRenderer,
): void {
    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);

    rootContainer = new Container({
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        backgroundColor: 0x1a1a1a,
        opacity: 0.85,
        borderRadius: 4,
        padding: 4,
        pixelSize: 0.001,
        sizeX: 0.2,
    });

    // row of element circles
    const row = new Container({
        flexDirection: 'row',
        gap: 3,
        justifyContent: 'center',
        alignItems: 'center',
    });

    elementContainers = [];
    for (let i = 0; i < elementKeys.length; i++) {
        const symbol = elementKeys[i];
        const data = ELEMENTS[symbol];
        const isSelected = i === selectedIndex;

        const circle = new Container({
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: data.color,
            borderWidth: isSelected ? 2 : 0,
            borderColor: 0xffffff,
            justifyContent: 'center',
            alignItems: 'center',
        });

        const c = new THREE.Color(data.color);
        const luminance = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        const textColor = luminance > 0.5 ? 0x000000 : 0xffffff;

        const txt = new Text({
            fontSize: 6,
            color: textColor,
            textAlign: 'center',
            verticalAlign: 'center',
            text: symbol,
        });
        circle.add(txt);

        elementContainers.push(circle);
        row.add(circle);
    }

    labelText = new Text({
        fontSize: 5,
        color: 0xcccccc,
        textAlign: 'center',
        text: ELEMENTS[elementKeys[selectedIndex]].name,
    });

    rootContainer.add(row);
    rootContainer.add(labelText);

    rootContainer.position.set(0, 0.06, -0.02);
    rootContainer.rotation.set(-Math.PI / 3, 0, 0);
    controller.add(rootContainer);
}

export function getSelectedElement(): string {
    return elementKeys[selectedIndex];
}

function updateSelectionVisuals(): void {
    for (let i = 0; i < elementContainers.length; i++) {
        elementContainers[i].setProperties({
            borderWidth: i === selectedIndex ? 2 : 0,
            borderColor: 0xffffff,
        });
    }
    if (labelText) {
        labelText.setProperties({ text: ELEMENTS[elementKeys[selectedIndex]].name });
    }
}

export function selectNext(): void {
    selectedIndex = (selectedIndex + 1) % elementKeys.length;
    updateSelectionVisuals();
}

export function selectPrev(): void {
    selectedIndex = (selectedIndex - 1 + elementKeys.length) % elementKeys.length;
    updateSelectionVisuals();
}

export function updateElementSelector(
    session: XRSession | null | undefined,
    controllerIndex: number,
    delta: number,
): void {
    // update uikit layout
    if (rootContainer) {
        rootContainer.update(delta);
    }

    // thumbstick cooldown
    if (thumbstickCooldown > 0) {
        thumbstickCooldown -= delta * 1000;
        return;
    }

    if (!session) return;

    const sources = session.inputSources;
    if (!sources) return;

    for (const source of sources) {
        if (!source.gamepad) continue;
        const isRight = (controllerIndex === 1 && source.handedness === 'right')
                     || (controllerIndex === 0 && source.handedness === 'left');
        if (!isRight) continue;

        const axes = source.gamepad.axes;
        const thumbX = axes.length >= 4 ? axes[2] : axes[0];
        if (thumbX === undefined) continue;

        if (thumbX > 0.5) {
            selectNext();
            thumbstickCooldown = COOLDOWN_TIME;
        } else if (thumbX < -0.5) {
            selectPrev();
            thumbstickCooldown = COOLDOWN_TIME;
        }
    }
}
