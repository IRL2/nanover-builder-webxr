import * as THREE from 'three';
import { Atom, MolecularStructure } from './molecularData.js';

export interface FragmentConnector {
    frameAtom: Atom;
    fragmentAtom: Atom;
    order: number;
}

export interface FragmentPlacementPreview {
    fragment: MolecularStructure;
    connectors: FragmentConnector[];
    frameHydrogensToRemove: Atom[];
}

const MergeType = {
    Invalid: 'invalid',
    HydrogenIntoHydrogen: 'hydrogen-into-hydrogen',
    HydrogenOnFragmentIntoFrame: 'hydrogen-on-fragment-into-frame',
    FragmentOntoFrameHydrogen: 'fragment-onto-frame-hydrogen',
} as const;

type MergeType = typeof MergeType[keyof typeof MergeType];

interface Merge {
    source: Atom;
    destination: Atom;
    type: MergeType;
    sourceParents: Atom[];
    destinationParents: Atom[];
}

const MERGE_DISTANCE_SQ = 0.0025;

export function buildFragmentPlacementPreview(
    frame: MolecularStructure,
    fragmentTemplate: MolecularStructure,
    fragmentTransform: THREE.Matrix4,
): FragmentPlacementPreview {
    const fragment = fragmentTemplate.transformed(fragmentTransform);
    const merges = computeMerges(frame, fragment);

    const fragmentHydrogensToRemove = new Set<Atom>();
    const frameHydrogensToRemove = new Set<Atom>();
    const connectors: FragmentConnector[] = [];

    for (const merge of merges) {
        switch (merge.type) {
            case MergeType.FragmentOntoFrameHydrogen:
                frameHydrogensToRemove.add(merge.destination);
                for (const parent of merge.destinationParents) {
                    connectors.push({ frameAtom: parent, fragmentAtom: merge.source, order: 1 });
                }
                break;
            case MergeType.HydrogenOnFragmentIntoFrame:
                fragmentHydrogensToRemove.add(merge.source);
                for (const parent of merge.sourceParents) {
                    connectors.push({ frameAtom: merge.destination, fragmentAtom: parent, order: 1 });
                }
                break;
            case MergeType.HydrogenIntoHydrogen:
                fragmentHydrogensToRemove.add(merge.source);
                frameHydrogensToRemove.add(merge.destination);
                for (const frameParent of merge.destinationParents) {
                    for (const fragmentParent of merge.sourceParents) {
                        connectors.push({ frameAtom: frameParent, fragmentAtom: fragmentParent, order: 1 });
                    }
                }
                break;
            case MergeType.Invalid:
                break;
        }
    }

    fragment.removeAtoms(fragmentHydrogensToRemove);
    let activeConnectors = connectors.filter(connector => fragment.atoms.includes(connector.fragmentAtom));

    const extraFragmentHydrogens = collectExtraFragmentHydrogens(activeConnectors);
    fragment.removeAtoms(extraFragmentHydrogens);
    activeConnectors = activeConnectors.filter(connector => fragment.atoms.includes(connector.fragmentAtom));

    const extraFrameHydrogens = collectExtraFrameHydrogens(frame, activeConnectors, frameHydrogensToRemove);
    for (const atom of extraFrameHydrogens) {
        frameHydrogensToRemove.add(atom);
    }

    return {
        fragment,
        connectors: activeConnectors,
        frameHydrogensToRemove: [...frameHydrogensToRemove],
    };
}

export function applyFragmentPlacementPreview(
    frame: MolecularStructure,
    preview: FragmentPlacementPreview,
): void {
    frame.removeAtoms(preview.frameHydrogensToRemove);

    const appendedAtoms = frame.appendStructureWithMap(preview.fragment);
    for (const connector of preview.connectors) {
        const fragmentAtom = appendedAtoms.get(connector.fragmentAtom);
        if (!fragmentAtom || !frame.atoms.includes(connector.frameAtom)) {
            continue;
        }

        frame.addBond(connector.frameAtom, fragmentAtom, connector.order);
    }

    frame.reindex();
}

function computeMerges(frame: MolecularStructure, fragment: MolecularStructure): Merge[] {
    const merges: Merge[] = [];

    for (const fragmentAtom of fragment.atoms) {
        for (const frameAtom of frame.atoms) {
            if (fragmentAtom.position.distanceToSquared(frameAtom.position) > MERGE_DISTANCE_SQ) {
                continue;
            }

            const type = canMergeAtoms(fragmentAtom, frameAtom);
            if (type === MergeType.Invalid) {
                continue;
            }

            merges.push({
                source: fragmentAtom,
                destination: frameAtom,
                type,
                sourceParents: fragmentAtom.bondedAtoms.filter(atom => atom !== frameAtom),
                destinationParents: frameAtom.bondedAtoms.filter(atom => atom !== fragmentAtom),
            });
        }
    }

    return merges;
}

function canMergeAtoms(fragmentAtom: Atom, frameAtom: Atom): MergeType {
    if (fragmentAtom.element === 'H' && frameAtom.element === 'H') {
        return MergeType.HydrogenIntoHydrogen;
    }

    if (fragmentAtom.element === 'H') {
        return MergeType.HydrogenOnFragmentIntoFrame;
    }

    if (frameAtom.element === 'H') {
        return MergeType.FragmentOntoFrameHydrogen;
    }

    return MergeType.Invalid;
}

function collectExtraFragmentHydrogens(connectors: FragmentConnector[]): Atom[] {
    const removals: Atom[] = [];
    const groupedTargets = groupTargetsByFragmentAtom(connectors);

    for (const [fragmentAtom, frameAtoms] of groupedTargets) {
        const hydrogenCount = fragmentAtom.bondedAtoms.filter(atom => atom.element === 'H').length;
        const excessBonds = Math.max(0, fragmentAtom.totalBondOrder + frameAtoms.length - fragmentAtom.valence);
        const removeCount = Math.min(hydrogenCount, excessBonds);
        if (removeCount === 0) {
            continue;
        }

        const targetPosition = averagePosition(frameAtoms.map(atom => atom.position));
        const candidates = fragmentAtom.bondedAtoms
            .filter(atom => atom.element === 'H')
            .sort((left, right) =>
                left.position.distanceToSquared(targetPosition) - right.position.distanceToSquared(targetPosition)
            );

        removals.push(...candidates.slice(0, removeCount));
    }

    return removals;
}

function collectExtraFrameHydrogens(
    _frame: MolecularStructure,
    connectors: FragmentConnector[],
    preRemovedHydrogens: ReadonlySet<Atom>,
): Atom[] {
    const removals: Atom[] = [];
    const groupedTargets = groupTargetsByFrameAtom(connectors);

    for (const [frameAtom, fragmentAtoms] of groupedTargets) {
        const removedBondOrder = frameAtom.bonds.reduce((sum, bond) => {
            const other = bond.a === frameAtom ? bond.b : bond.a;
            return preRemovedHydrogens.has(other) ? sum + bond.order : sum;
        }, 0);

        const hydrogenCount = frameAtom.bondedAtoms.filter(
            atom => atom.element === 'H' && !preRemovedHydrogens.has(atom)
        ).length;
        const effectiveBondOrder = frameAtom.totalBondOrder - removedBondOrder;
        const excessBonds = Math.max(0, effectiveBondOrder + fragmentAtoms.length - frameAtom.valence);
        const removeCount = Math.min(hydrogenCount, excessBonds);
        if (removeCount === 0) {
            continue;
        }

        const targetPosition = averagePosition(fragmentAtoms.map(atom => atom.position));
        const candidates = frameAtom.bondedAtoms
            .filter(atom => atom.element === 'H' && !preRemovedHydrogens.has(atom))
            .sort((left, right) =>
                left.position.distanceToSquared(targetPosition) - right.position.distanceToSquared(targetPosition)
            );

        removals.push(...candidates.slice(0, removeCount));
    }

    return removals;
}

function groupTargetsByFragmentAtom(connectors: FragmentConnector[]): Map<Atom, Atom[]> {
    const grouped = new Map<Atom, Atom[]>();

    for (const connector of connectors) {
        const targets = grouped.get(connector.fragmentAtom) ?? [];
        targets.push(connector.frameAtom);
        grouped.set(connector.fragmentAtom, targets);
    }

    return grouped;
}

function groupTargetsByFrameAtom(connectors: FragmentConnector[]): Map<Atom, Atom[]> {
    const grouped = new Map<Atom, Atom[]>();

    for (const connector of connectors) {
        const targets = grouped.get(connector.frameAtom) ?? [];
        targets.push(connector.fragmentAtom);
        grouped.set(connector.frameAtom, targets);
    }

    return grouped;
}

function averagePosition(positions: THREE.Vector3[]): THREE.Vector3 {
    const average = new THREE.Vector3();
    for (const position of positions) {
        average.add(position);
    }

    return average.multiplyScalar(1 / Math.max(positions.length, 1));
}
