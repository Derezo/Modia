import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const metadataRoot = path.join(root, "ai-image-metadata/characters");
const specRoot = path.join(metadataRoot, "player-authored-animations");
const sourceRoot = path.join(metadataRoot, "player-animation-sources");
const classes = [
  "berserker", "paladin", "guardian", "warlord",
  "sorcerer", "summoner", "conjurer", "oracle",
  "ninja", "martial_artist", "brawler", "ascetic",
  "alchemist", "medic", "plague_doctor", "artificer",
];
const issues = [];
let pairs = 0;

for (const race of ["human", "dwarf", "elf", "orc", "vampire"]) {
  for (const gender of ["male", "female", "other"]) {
    if (race === "human" && gender === "male") continue;
    for (const playerClass of classes) {
      const id = `${race}_${gender}_${playerClass}`;
      const spec = JSON.parse(
        await fs.readFile(path.join(specRoot, `${id}.json`), "utf8"),
      );
      for (const action of Object.keys(spec.animations).filter(
        (name) => name !== "dead",
      )) {
        const acceptedPath = path.join(sourceRoot, id, `${action}.png`);
        const chromaPath = path.join(sourceRoot, id, "chroma", `${action}.png`);
        let accepted;
        let chroma;
        try {
          [accepted, chroma] = await Promise.all([
            sharp(acceptedPath).metadata(),
            sharp(chromaPath).metadata(),
          ]);
        } catch (error) {
          issues.push(`${id}/${action}: ${error.message}`);
          continue;
        }
        pairs += 1;
        if (accepted.format !== "png" || accepted.channels !== 4) {
          issues.push(`${id}/${action}: accepted source is not RGBA PNG`);
        }
        if (chroma.format !== "png") {
          issues.push(`${id}/${action}: chroma source is not PNG`);
        }
        if (
          accepted.width !== chroma.width ||
          accepted.height !== chroma.height
        ) {
          issues.push(`${id}/${action}: accepted/chroma dimensions differ`);
        }
      }
    }
  }
}

if (issues.length > 0) {
  console.error(issues.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${pairs} player action source/chroma pairs.`);
}
