import * as THREE from 'three';
import type { MolecularStructure } from './molecularData.js';
import { molecule, simulationSpace, atomGeometry, simulationToWorldSpace, BOND_SCALE } from './state.js';
import { getSelectedBuildMode, getSelectedPreset, setPresetCatalog, setPresetStatus } from './elementSelector.js';
import { loadPresetManifest, loadPresetStructure } from './presetLibrary.js';
import { applyFragmentPlacementPreview, buildFragmentPlacementPreview } from './fragmentPlacement.js';
import type { FragmentPlacementPreview } from './fragmentPlacement.js';
import { getControllerSimulationMatrix } from './xrInput.js';
import { buildBondSegments } from './visuals/bondMesh.js';
import { rebuildVisuals } from './visuals/moleculeView.js';
import { ghostGroup, guidelineGroup, renderGhostStructure } from './visuals/ghostView.js';

let selectedFragmentTemplate: MolecularStructure | null = null;
let presetLoadRequestId = 0;
const presetStructureCache = new Map<string, MolecularStructure>();

const fragmentConnectorMat = new THREE.MeshStandardMaterial({ color: 0x66ff99, transparent: true, opacity: 0.45, depthWrite: false });
const fragmentHydrogenRemovalMat = new THREE.MeshStandardMaterial({ color: 0xffaa44, transparent: true, opacity: 0.45, depthWrite: false });

export async function setupPresetLibrary(): Promise<void> {
    try {
        const manifest = await loadPresetManifest();
        const categories = manifest.categories.filter(category => category.presets.length > 0);
        setPresetCatalog(categories);
        setPresetStatus(categories.length > 0 ? 'Preset library ready' : 'No presets available');
        void refreshSelectedFragment();
    } catch (error) {
        console.error('Failed to initialise the preset library.', error);
        setPresetCatalog([]);
        selectedFragmentTemplate = null;
        setPresetStatus('Preset library unavailable');
    }
}

export async function refreshSelectedFragment(): Promise<void> {
    const mode = getSelectedBuildMode();
    const preset = getSelectedPreset();

    if (mode !== 'preset') {
        presetLoadRequestId += 1;
        selectedFragmentTemplate = null;
        setPresetStatus(mode === 'bond' ? 'Bond editing ready' : 'Atom placement ready');
        return;
    }

    if (!preset) {
        presetLoadRequestId += 1;
        selectedFragmentTemplate = null;
        setPresetStatus('No preset selected');
        return;
    }

    const cached = presetStructureCache.get(preset.path);
    if (cached) {
        selectedFragmentTemplate = cached;
        setPresetStatus(`${preset.label} ready`);
        return;
    }

    const requestId = ++presetLoadRequestId;
    selectedFragmentTemplate = null;
    setPresetStatus(`Loading ${preset.label}...`);

    try {
        const structure = await loadPresetStructure(preset);
        if (requestId !== presetLoadRequestId) return;
        presetStructureCache.set(preset.path, structure);
        selectedFragmentTemplate = structure;
        setPresetStatus(`${preset.label} ready`);
    } catch (error) {
        if (requestId !== presetLoadRequestId) return;
        console.error(`Failed to load preset ${preset.label}.`, error);
        selectedFragmentTemplate = null;
        setPresetStatus(`Failed to load ${preset.label}`);
    }
}

export function placeSelectedFragment(controller: THREE.XRTargetRaySpace): void {
    if (!selectedFragmentTemplate) return;

    const fragmentTransform = getControllerSimulationMatrix(controller);
    if (!fragmentTransform) return;

    const preview = buildFragmentPlacementPreview(molecule, selectedFragmentTemplate, fragmentTransform);
    applyFragmentPlacementPreview(molecule, preview);
    rebuildVisuals();
}

export function updateFragmentGhostPreview(controller: THREE.XRTargetRaySpace): void {
    if (!selectedFragmentTemplate) return;

    const fragmentTransform = getControllerSimulationMatrix(controller);
    if (!fragmentTransform) return;

    const preview = buildFragmentPlacementPreview(molecule, selectedFragmentTemplate, fragmentTransform);
    renderGhostStructure(preview.fragment);
    renderFragmentConnections(preview);
}

function renderFragmentConnections(preview: FragmentPlacementPreview): void {
    const simScale = simulationSpace.scale.x;

    for (const connector of preview.connectors) {
        const start = simulationToWorldSpace(connector.frameAtom.position);
        const end = simulationToWorldSpace(connector.fragmentAtom.position);
        buildBondSegments(
            ghostGroup,
            start,
            end,
            Math.max(connector.frameAtom.scale, connector.fragmentAtom.scale) * BOND_SCALE * simScale,
            1,
            fragmentConnectorMat,
        );
    }

    for (const hydrogen of preview.frameHydrogensToRemove) {
        const sphere = new THREE.Mesh(atomGeometry, fragmentHydrogenRemovalMat);
        sphere.position.copy(simulationToWorldSpace(hydrogen.position));
        sphere.scale.setScalar(hydrogen.scale / 2 * simScale * 1.15);
        guidelineGroup.add(sphere);
    }
}
