import { Dictionary } from '../types';

/** Helper to fetch and parse a JSON file relative to the current module. */
async function readJson(url: string | URL) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Unable to load ${url}: ${response.status}`);
    }
    return response.json();
}

/**
 * Loads the complete symbol dictionary, including sigils, signs, and sample spell diagrams.
 * This is called once during application initialization.
 */
export async function loadDictionary(): Promise<Dictionary> {
    const [sigils, signs, sampleSpells] = await Promise.all([
        readJson(new URL('./sigils.json', import.meta.url)),
        readJson(new URL('./signs.json', import.meta.url)),
        readJson(new URL('./sample-spells.json', import.meta.url)),
    ]);

    return {
        sigils,
        signs,
        sampleSpells,
    };
}
