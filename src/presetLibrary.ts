import * as THREE from 'three';
import { ELEMENTS } from './elementValues.js';
import { MolecularStructure } from './molecularData.js';

export interface PresetInfo {
    id: string;
    label: string;
    path: string;
}

export interface PresetCategory {
    id: string;
    label: string;
    presets: PresetInfo[];
}

interface PresetManifest {
    categories: PresetCategory[];
}

type Mol2Section = 'none' | 'atoms' | 'bonds';

interface Mol2AtomRecord {
    id: number;
    element: string;
    position: THREE.Vector3;
}

interface Mol2BondRecord {
    sourceId: number;
    targetId: number;
    order: number;
}

export async function loadPresetManifest(): Promise<PresetManifest> {
    const response = await fetch(new URL('presets/manifest.json', window.location.href));
    if (!response.ok) {
        throw new Error(`Failed to load preset manifest: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<PresetManifest>;
}

export async function loadPresetStructure(preset: PresetInfo): Promise<MolecularStructure> {
    const response = await fetch(new URL(preset.path, window.location.href));
    if (!response.ok) {
        throw new Error(`Failed to load preset ${preset.label}: ${response.status} ${response.statusText}`);
    }

    return parseMol2(await response.text());
}

function parseMol2(mol2Text: string): MolecularStructure {
    const atoms: Mol2AtomRecord[] = [];
    const bonds: Mol2BondRecord[] = [];
    const lines = mol2Text.split(/\r?\n/);
    let section: Mol2Section = 'none';

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }

        if (line === '@<TRIPOS>ATOM') {
            section = 'atoms';
            continue;
        }

        if (line === '@<TRIPOS>BOND') {
            section = 'bonds';
            continue;
        }

        if (line.startsWith('@<TRIPOS>')) {
            section = 'none';
            continue;
        }

        if (section === 'atoms') {
            const parts = line.split(/\s+/);
            if (parts.length < 6) {
                throw new Error(`Invalid MOL2 atom record: ${line}`);
            }

            const id = Number.parseInt(parts[0], 10);
            const x = Number.parseFloat(parts[2]);
            const y = Number.parseFloat(parts[3]);
            const z = Number.parseFloat(parts[4]);

            if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                throw new Error(`Invalid MOL2 atom coordinates: ${line}`);
            }

            atoms.push({
                id,
                element: normaliseElementSymbol(parts[5], parts[1]),
                position: new THREE.Vector3(x, y, z).multiplyScalar(0.1),
            });
            continue;
        }

        if (section === 'bonds') {
            const parts = line.split(/\s+/);
            if (parts.length < 4) {
                throw new Error(`Invalid MOL2 bond record: ${line}`);
            }

            const sourceId = Number.parseInt(parts[1], 10);
            const targetId = Number.parseInt(parts[2], 10);
            if (!Number.isFinite(sourceId) || !Number.isFinite(targetId)) {
                throw new Error(`Invalid MOL2 bond indices: ${line}`);
            }

            bonds.push({
                sourceId,
                targetId,
                order: parseBondOrder(parts[3]),
            });
        }
    }

    if (atoms.length === 0) {
        throw new Error('Preset file does not contain any atoms.');
    }

    const bounds = new THREE.Box3();
    for (const atom of atoms) {
        bounds.expandByPoint(atom.position);
    }
    const centre = bounds.getCenter(new THREE.Vector3());

    const structure = new MolecularStructure();
    const atomMap = new Map<number, ReturnType<MolecularStructure['addAtom']>>();

    for (const atom of atoms) {
        const addedAtom = structure.addAtom(atom.element, atom.position.clone().sub(centre));
        atomMap.set(atom.id, addedAtom);
    }

    for (const bond of bonds) {
        const source = atomMap.get(bond.sourceId);
        const target = atomMap.get(bond.targetId);
        if (!source || !target) {
            throw new Error(`Bond references missing atom ids ${bond.sourceId} and ${bond.targetId}.`);
        }

        structure.addBond(source, target, bond.order);
    }

    structure.reindex();
    return structure;
}

function parseBondOrder(orderToken: string): number {
    if (orderToken === 'ar' || orderToken === 'am') {
        return 1;
    }

    const parsed = Number.parseFloat(orderToken);
    if (!Number.isFinite(parsed)) {
        return 1;
    }

    return Math.max(1, Math.min(3, Math.round(parsed)));
}

function normaliseElementSymbol(atomType: string, atomName: string): string {
    const candidates = [atomType.split('.')[0], atomName];

    for (const candidate of candidates) {
        const resolved = resolveElementCandidate(candidate);
        if (resolved) {
            return resolved;
        }
    }

    return 'C';
}

function resolveElementCandidate(candidate: string): string | null {
    const lettersOnly = candidate.replace(/[^A-Za-z]/g, '');
    if (lettersOnly.length === 0) {
        return null;
    }

    const variants = [
        formatElementSymbol(lettersOnly),
        formatElementSymbol(lettersOnly.slice(0, 2)),
        formatElementSymbol(lettersOnly.slice(0, 1)),
    ].filter((value): value is string => value.length > 0);

    for (const variant of variants) {
        if (ELEMENTS[variant]) {
            return variant;
        }
    }

    return variants[0] ?? null;
}

function formatElementSymbol(raw: string): string {
    if (raw.length === 0) {
        return '';
    }

    return raw.length === 1
        ? raw.toUpperCase()
        : `${raw[0].toUpperCase()}${raw.slice(1).toLowerCase()}`;
}
