import * as THREE from 'three';
import { molecule, atomGeometry, BOND_SCALE } from '../state.js';
import { buildBondSegmentsBicolor } from './bondMesh.js';

export const atomGroup = new THREE.Group();
export const bondGroup = new THREE.Group();

export function rebuildVisuals(): void {
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
        const matA = new THREE.MeshStandardMaterial({ color: bond.a.color, roughness: 0.6, metalness: 0.1 });
        const matB = new THREE.MeshStandardMaterial({ color: bond.b.color, roughness: 0.6, metalness: 0.1 });
        buildBondSegmentsBicolor(
            bondGroup,
            bond.a.position,
            bond.b.position,
            Math.max(bond.a.scale, bond.b.scale) * BOND_SCALE,
            bond.order,
            matA,
            matB,
            { bond },
        );
    }
}
