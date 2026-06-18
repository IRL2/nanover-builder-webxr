import { Container, Text, reversePainterSortStable } from '@pmndrs/uikit';
import * as THREE from 'three';
import { ELEMENTS } from './elementValues.js';
import type { PresetCategory, PresetInfo } from './presetLibrary.js';

export type BuildMode = 'atom' | 'preset' | 'bond';
export type BondPlacementOrder = 1 | 2 | 3;

type FocusSection = 'mode' | 'primary' | 'secondary';
type SelectionChangeHandler = () => void;

const elementKeys = Object.keys(ELEMENTS);
const bondOrderOptions: ReadonlyArray<{ label: string; order: BondPlacementOrder }> = [
    { label: 'Single bond', order: 1 },
    { label: 'Double bond', order: 2 },
    { label: 'Triple bond', order: 3 },
];

let selectedElementIndex = 0;
let buildMode: BuildMode = 'atom';
let presetCategories: PresetCategory[] = [];
let selectedCategoryIndex = 0;
let selectedPresetIndex = 0;
let selectedBondOrderIndex = 0;
let focusIndex = 1;
let statusMessage = 'Loading preset library...';

let rootContainer: Container | undefined;
let modeContainer: Container | undefined;
let primaryContainer: Container | undefined;
let secondaryContainer: Container | undefined;
let atomOptionsRow: Container | undefined;
let elementContainers: Container[] = [];
let modeText: Text | undefined;
let primaryText: Text | undefined;
let secondaryText: Text | undefined;
let statusText: Text | undefined;
let selectionChangeHandler: SelectionChangeHandler | undefined;

let thumbstickCooldown = 0;
const COOLDOWN_TIME = 250;
const ACTIVE_BG = 0x3a3a3a;
const IDLE_BG = 0x232323;
const DISABLED_BG = 0x171717;
const ATOM_ROOT_WIDTH = 0.21;
const PRESET_ROOT_WIDTH = 0.235;
const ATOM_ROW_WIDTH = 190;
const PRESET_ROW_WIDTH = 215;

export function createElementSelector(
    controller: THREE.XRTargetRaySpace,
    renderer: THREE.WebGLRenderer,
    onSelectionChange?: SelectionChangeHandler,
): void {
    selectionChangeHandler = onSelectionChange;

    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);

    rootContainer = new Container({
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 2,
        backgroundColor: 0x111111,
        opacity: 0.92,
        borderRadius: 5,
        padding: 4,
        pixelSize: 0.001,
        sizeX: 0.24,
    });

    const title = new Text({
        fontSize: 6,
        color: 0xffffff,
        textAlign: 'center',
        text: 'NanoVer Builder',
    });

    const helpText = new Text({
        fontSize: 3.8,
        color: 0xaaaaaa,
        textAlign: 'center',
        text: 'Thumbstick up/down: focus, left/right: change',
    });

    modeContainer = createInfoRow();
    primaryContainer = createInfoRow();
    secondaryContainer = createInfoRow();

    atomOptionsRow = new Container({
        flexDirection: 'row',
        gap: 2,
        justifyContent: 'center',
        alignItems: 'center',
    });

    modeText = createInfoText();
    primaryText = createInfoText();
    secondaryText = createInfoText();

    modeContainer.add(modeText);
    primaryContainer.setProperties({ gap: 4, justifyContent: 'center', alignItems: 'center' });
    elementContainers = [];
    for (const symbol of elementKeys) {
        const data = ELEMENTS[symbol];
        const textColor = getReadableTextColor(data.color);
        const circle = new Container({
            width: 16,
            height: 16,
            minWidth: 16,
            minHeight: 16,
            borderRadius: 8,
            backgroundColor: data.color,
            justifyContent: 'center',
            alignItems: 'center',
        });

        const txt = new Text({
            fontSize: 5,
            color: textColor,
            textAlign: 'center',
            verticalAlign: 'center',
            text: symbol,
        });

        circle.add(txt);
        elementContainers.push(circle);
        atomOptionsRow.add(circle);
    }

    primaryContainer.add(atomOptionsRow);
    primaryContainer.add(primaryText);
    secondaryContainer.add(secondaryText);

    statusText = new Text({
        fontSize: 4,
        color: 0x7fd4ff,
        textAlign: 'center',
        text: statusMessage,
    });

    rootContainer.add(title);
    rootContainer.add(helpText);
    rootContainer.add(modeContainer);
    rootContainer.add(primaryContainer);
    rootContainer.add(secondaryContainer);
    rootContainer.add(statusText);

    rootContainer.position.set(0, 0.07, -0.03);
    rootContainer.rotation.set(-Math.PI / 3, 0, 0);
    controller.add(rootContainer);

    updateSelectionVisuals();
}

export function getSelectedBuildMode(): BuildMode {
    return buildMode;
}

export function getSelectedElement(): string {
    return elementKeys[selectedElementIndex];
}

export function getSelectedPreset(): PresetInfo | null {
    const category = presetCategories[selectedCategoryIndex];
    return category?.presets[selectedPresetIndex] ?? null;
}

export function getSelectedBondOrder(): BondPlacementOrder {
    return bondOrderOptions[selectedBondOrderIndex]?.order ?? 1;
}

export function setPresetCatalog(categories: PresetCategory[]): void {
    presetCategories = categories.filter(category => category.presets.length > 0);
    selectedCategoryIndex = 0;
    selectedPresetIndex = 0;

    if (presetCategories.length === 0 && buildMode === 'preset') {
        buildMode = 'atom';
        focusIndex = Math.min(focusIndex, getFocusSections().length - 1);
    }

    updateSelectionVisuals();
    notifySelectionChanged();
}

export function setPresetStatus(status: string): void {
    statusMessage = status;
    statusText?.setProperties({ text: statusMessage });
}

export function updateElementSelector(
    session: XRSession | null | undefined,
    controllerIndex: number,
    delta: number,
): void {
    rootContainer?.update(delta);

    if (thumbstickCooldown > 0) {
        thumbstickCooldown -= delta * 1000;
        return;
    }

    if (!session) {
        return;
    }

    for (const source of session.inputSources) {
        if (!source.gamepad) {
            continue;
        }

        const matchesController = (controllerIndex === 1 && source.handedness === 'right')
            || (controllerIndex === 0 && source.handedness === 'left');
        if (!matchesController) {
            continue;
        }

        const axes = source.gamepad.axes;
        const thumbX = axes.length >= 4 ? axes[2] : axes[0];
        const thumbY = axes.length >= 4 ? axes[3] : axes[1];

        const absX = Math.abs(thumbX ?? 0);
        const absY = Math.abs(thumbY ?? 0);
        if (absX < 0.5 && absY < 0.5) {
            continue;
        }

        if (absY >= absX && thumbY !== undefined && absY >= 0.5) {
            moveFocus(thumbY > 0 ? 1 : -1);
        } else if (thumbX !== undefined && absX >= 0.5) {
            changeFocusedValue(thumbX > 0 ? 1 : -1);
        }

        thumbstickCooldown = COOLDOWN_TIME;
        return;
    }
}

function createInfoRow(): Container {
    return new Container({
        width: ATOM_ROW_WIDTH,
        padding: 2,
        borderRadius: 3,
        backgroundColor: IDLE_BG,
        opacity: 0.9,
    });
}

function createInfoText(): Text {
    return new Text({
        fontSize: 4.5,
        color: 0xffffff,
        textAlign: 'left',
        text: '',
    });
}

function getFocusSections(): FocusSection[] {
    return buildMode === 'preset'
        ? ['mode', 'primary', 'secondary']
        : ['mode', 'primary'];
}

function getAvailableBuildModes(): BuildMode[] {
    return presetCategories.length > 0
        ? ['atom', 'preset', 'bond']
        : ['atom', 'bond'];
}

function getModeLabel(mode: BuildMode): string {
    switch (mode) {
        case 'atom':
            return 'Atom placement';
        case 'preset':
            return 'Preset fragment';
        case 'bond':
            return 'Bond editing';
    }
}

function moveFocus(step: number): void {
    const sections = getFocusSections();
    focusIndex = Math.max(0, Math.min(sections.length - 1, focusIndex + step));
    updateSelectionVisuals();
}

function changeFocusedValue(step: number): void {
    const section = getFocusSections()[focusIndex];
    let changed = false;

    switch (section) {
        case 'mode':
            {
                const modes = getAvailableBuildModes();
                const currentModeIndex = Math.max(0, modes.indexOf(buildMode));
                buildMode = modes[cycleIndex(currentModeIndex, modes.length, step)];
            }
            focusIndex = Math.min(focusIndex, getFocusSections().length - 1);
            changed = true;
            break;
        case 'primary':
            if (buildMode === 'atom') {
                selectedElementIndex = cycleIndex(selectedElementIndex, elementKeys.length, step);
                changed = true;
            } else if (buildMode === 'bond') {
                selectedBondOrderIndex = cycleIndex(selectedBondOrderIndex, bondOrderOptions.length, step);
                changed = true;
            } else if (presetCategories.length > 0) {
                selectedCategoryIndex = cycleIndex(selectedCategoryIndex, presetCategories.length, step);
                selectedPresetIndex = 0;
                changed = true;
            }
            break;
        case 'secondary':
            if (buildMode === 'preset') {
                const presetCount = presetCategories[selectedCategoryIndex]?.presets.length ?? 0;
                if (presetCount > 0) {
                    selectedPresetIndex = cycleIndex(selectedPresetIndex, presetCount, step);
                    changed = true;
                }
            }
            break;
    }

    if (changed) {
        updateSelectionVisuals();
        notifySelectionChanged();
    }
}

function updateSelectionVisuals(): void {
    const element = getSelectedElement();
    const presetCategory = presetCategories[selectedCategoryIndex];
    const preset = getSelectedPreset();
    const selectedBondOrder = bondOrderOptions[selectedBondOrderIndex];
    const isAtomMode = buildMode === 'atom';
    const isBondMode = buildMode === 'bond';
    const isPresetMode = buildMode === 'preset';
    const usesWideLayout = isPresetMode || isBondMode;
    const elementData = ELEMENTS[element];

    rootContainer?.setProperties({
        sizeX: usesWideLayout ? PRESET_ROOT_WIDTH : ATOM_ROOT_WIDTH,
    });

    modeText?.setProperties({
        fontSize: usesWideLayout ? 5.4 : 4.8,
        text: `Mode: ${getModeLabel(buildMode)}`,
    });

    if (isAtomMode) {
        atomOptionsRow?.setProperties({
            display: 'flex',
            opacity: 1,
            width: ATOM_ROW_WIDTH - 20,
            height: undefined,
            minWidth: undefined,
            minHeight: undefined,
        });
        primaryText?.setProperties({
            fontSize: 0,
            text: '',
        });
        secondaryText?.setProperties({
            text: elementData.name,
            fontSize: 5.2,
            color: 0xffffff,
        });
        updateAtomSelectionVisuals();
    } else if (isPresetMode) {
        atomOptionsRow?.setProperties({
            display: 'none',
            width: 0,
            height: 0,
            minWidth: 0,
            minHeight: 0,
            opacity: 0,
        });
        primaryText?.setProperties({
            fontSize: 5.8,
            text: `Category: ${presetCategory?.label ?? 'No presets available'}`,
        });
        secondaryText?.setProperties({
            fontSize: 5.6,
            text: `Preset: ${preset?.label ?? 'No preset selected'}`,
            color: 0xffffff,
        });
    } else {
        atomOptionsRow?.setProperties({
            display: 'none',
            width: 0,
            height: 0,
            minWidth: 0,
            minHeight: 0,
            opacity: 0,
        });
        primaryText?.setProperties({
            fontSize: 5.4,
            text: `Bond order: ${selectedBondOrder?.label ?? 'Single bond'}`,
        });
        secondaryText?.setProperties({
            fontSize: 4.6,
            text: 'Left: select 2 atoms, right: delete',
            color: 0xcccccc,
        });
    }

    applyContainerState(modeContainer, 0, true);
    applyContainerState(primaryContainer, 1, true);
    applyContainerState(secondaryContainer, 2, isPresetMode);
    secondaryContainer?.setProperties({
        width: usesWideLayout ? PRESET_ROW_WIDTH : ATOM_ROW_WIDTH,
    });
    primaryContainer?.setProperties({
        width: usesWideLayout ? PRESET_ROW_WIDTH : ATOM_ROW_WIDTH,
    });
    modeContainer?.setProperties({
        width: usesWideLayout ? PRESET_ROW_WIDTH : ATOM_ROW_WIDTH,
    });
    statusText?.setProperties({
        text: statusMessage,
        fontSize: isPresetMode ? 4.6 : 4,
    });
}

function applyContainerState(container: Container | undefined, index: number, enabled: boolean): void {
    if (!container) {
        return;
    }

    const isFocused = index === focusIndex && index < getFocusSections().length;
    container.setProperties({
        backgroundColor: enabled
            ? (isFocused ? ACTIVE_BG : IDLE_BG)
            : DISABLED_BG,
        opacity: enabled ? 0.95 : 0.5,
    });
}

function cycleIndex(index: number, size: number, step: number): number {
    if (size <= 0) {
        return 0;
    }

    return (index + step + size) % size;
}

function updateAtomSelectionVisuals(): void {
    for (let i = 0; i < elementContainers.length; i++) {
        elementContainers[i].setProperties({
            borderWidth: i === selectedElementIndex ? 2 : 0,
            borderColor: 0xffffff,
            opacity: i === selectedElementIndex ? 1 : 0.85,
        });
    }
}

function getReadableTextColor(backgroundColor: number): number {
    const color = new THREE.Color(backgroundColor);
    const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
    return luminance > 0.5 ? 0x000000 : 0xffffff;
}

function notifySelectionChanged(): void {
    selectionChangeHandler?.();
}
