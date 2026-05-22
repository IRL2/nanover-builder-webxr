import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const unityPresetRoot = path.resolve(projectRoot, '..', 'Assets', 'StreamingAssets');
const outputRoot = path.resolve(projectRoot, 'public', 'presets');

const presetCategories = [
    { id: 'AminoAcids', label: 'Amino Acids' },
    { id: 'Biomolecules', label: 'Biomolecules' },
    { id: 'Carbonyls', label: 'Functional Groups' },
    { id: 'RGroups', label: 'R Groups' },
    { id: 'Rings', label: 'Rings' },
    { id: 'UserFragments', label: 'User Fragments' },
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const manifest = {
    categories: [],
};

for (const category of presetCategories) {
    const sourceDir = path.join(unityPresetRoot, category.id);
    const targetDir = path.join(outputRoot, category.id);
    await mkdir(targetDir, { recursive: true });

    const files = (await readdir(sourceDir, { withFileTypes: true }))
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.mol2')
        .map(entry => entry.name)
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));

    for (const fileName of files) {
        await copyFile(path.join(sourceDir, fileName), path.join(targetDir, fileName));
    }

    manifest.categories.push({
        id: category.id,
        label: category.label,
        presets: files.map(fileName => ({
            id: path.basename(fileName, path.extname(fileName)),
            label: path.basename(fileName, path.extname(fileName)),
            path: ['presets', category.id, fileName].map(segment => encodeURIComponent(segment)).join('/'),
        })),
    });
}

await writeFile(
    path.join(outputRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
);

const totalPresetCount = manifest.categories.reduce((total, category) => total + category.presets.length, 0);
console.log(`Synced ${totalPresetCount} preset structures across ${manifest.categories.length} categories.`);
