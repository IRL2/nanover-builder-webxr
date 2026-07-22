import * as THREE from 'three';

const MULTI_BOND_SHRINK = 0.8;
const MULTI_BOND_SPACING = 2.5;

const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);

export function getRenderedBondRadius(baseBondRadius: number, order: number): number {
    return baseBondRadius * Math.pow(MULTI_BOND_SHRINK, Math.max(0, order - 1));
}

export function getBondHitRadius(baseBondRadius: number, order: number): number {
    const renderedBondRadius = getRenderedBondRadius(baseBondRadius, order);
    return order === 1
        ? renderedBondRadius
        : renderedBondRadius * (MULTI_BOND_SPACING + 1);
}

function bondOrderOffsets(order: number, dir: THREE.Vector3, bondRadius: number): THREE.Vector3[] {
    if (order === 1) return [new THREE.Vector3()];
    const perp = new THREE.Vector3();
    if (Math.abs(dir.x) < 0.9) perp.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    else perp.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const spacing = bondRadius * MULTI_BOND_SPACING;
    if (order === 2) return [perp.clone().multiplyScalar(spacing), perp.clone().multiplyScalar(-spacing)];
    const perp2 = new THREE.Vector3().crossVectors(dir, perp).normalize();
    return [
        perp.clone().multiplyScalar(spacing),
        perp.clone().multiplyScalar(-spacing / 2).add(perp2.clone().multiplyScalar(spacing * 0.866)),
        perp.clone().multiplyScalar(-spacing / 2).add(perp2.clone().multiplyScalar(-spacing * 0.866)),
    ];
}

export function buildBondSegments(
    group: THREE.Group,
    start: THREE.Vector3,
    end: THREE.Vector3,
    baseBondRadius: number,
    order: number,
    material: THREE.Material,
    userData?: Record<string, unknown>,
): void {
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    const bondRadius = getRenderedBondRadius(baseBondRadius, order);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize()
    );

    const offsets = bondOrderOffsets(order, dir, bondRadius);
    for (const offset of offsets) {
        const cyl = new THREE.Mesh(bondGeometry, material);
        cyl.position.copy(mid).add(offset);
        cyl.scale.set(bondRadius, len, bondRadius);
        cyl.quaternion.copy(orientation);
        if (userData) cyl.userData = { ...userData };
        group.add(cyl);
    }
}

export function buildBondSegmentsBicolor(
    group: THREE.Group,
    start: THREE.Vector3,
    end: THREE.Vector3,
    baseBondRadius: number,
    order: number,
    matA: THREE.Material,
    matB: THREE.Material,
    userData?: Record<string, unknown>,
): void {
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    const halfLen = len / 2;
    const bondRadius = getRenderedBondRadius(baseBondRadius, order);
    const orientation = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), dir.clone().normalize()
    );

    const offsets = bondOrderOffsets(order, dir, bondRadius);
    for (const offset of offsets) {
        const midA = start.clone().add(mid).multiplyScalar(0.5);
        const meshA = new THREE.Mesh(bondGeometry, matA);
        meshA.position.copy(midA).add(offset);
        meshA.scale.set(bondRadius, halfLen, bondRadius);
        meshA.quaternion.copy(orientation);
        if (userData) meshA.userData = { ...userData };
        group.add(meshA);

        const midB = mid.clone().add(end).multiplyScalar(0.5);
        const meshB = new THREE.Mesh(bondGeometry, matB);
        meshB.position.copy(midB).add(offset);
        meshB.scale.set(bondRadius, halfLen, bondRadius);
        meshB.quaternion.copy(orientation);
        if (userData) meshB.userData = { ...userData };
        group.add(meshB);
    }
}
