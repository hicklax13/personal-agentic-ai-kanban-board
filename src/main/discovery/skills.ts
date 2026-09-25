import { promises as fs, type Dirent } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { DiscoveredSkill } from '@shared/types';

/**
 * Pull `name` and `description` out of a SKILL.md YAML front-matter block.
 *
 * A deliberately small hand-rolled reader rather than a YAML dependency: skill
 * front matter only ever uses flat `key: value` pairs, and the description is
 * the one field that routinely runs long enough to be quoted or folded.
 */
export function parseSkillFrontMatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const body = match[1];
  const out: { name?: string; description?: string } = {};

  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(name|description):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();

    // Folded/literal blocks: `description: >-` then indented continuation lines.
    if (value === '|' || value === '>' || value === '>-' || value === '|-') {
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (!/^\s+\S/.test(lines[j])) break;
        collected.push(lines[j].trim());
        i = j;
      }
      value = collected.join(' ');
    }

    value = value.replace(/^["']/, '').replace(/["']$/, '');
    if (kv[1] === 'name') out.name = value;
    else out.description = value;
  }
  return out;
}

async function readSkill(
  skillMdPath: string,
  source: string,
): Promise<DiscoveredSkill | null> {
  try {
    const text = await fs.readFile(skillMdPath, 'utf8');
    const fm = parseSkillFrontMatter(text);
    const dirName = basename(dirname(skillMdPath));
    const name = fm.name || dirName;
    return {
      id: `${source}:${name}`,
      name,
      description: (fm.description ?? '').slice(0, 400),
      source,
      path: skillMdPath,
    };
  } catch {
    return null;
  }
}

/** Walk a tree looking for SKILL.md, bounded by depth so a deep tree cannot stall startup. */
async function findSkillFiles(root: string, maxDepth: number): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subdirs: string[] = [];
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'SKILL.md') {
        found.push(join(dir, entry.name));
      } else if (
        entry.isDirectory() &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.')
      ) {
        subdirs.push(join(dir, entry.name));
      }
    }
    // Parallel per level: much faster than serial walking over the ~450 skill
    // directories a fully-loaded Claude install produces.
    await Promise.all(subdirs.map((d) => walk(d, depth + 1)));
  }

  await walk(root, 0);
  return found;
}

export async function discoverSkills(
  roots: { path: string; source: string; maxDepth: number }[],
): Promise<DiscoveredSkill[]> {
  const all: DiscoveredSkill[] = [];
  for (const root of roots) {
    const files = await findSkillFiles(root.path, root.maxDepth);
    const skills = await Promise.all(files.map((f) => readSkill(f, root.source)));
    for (const s of skills) if (s) all.push(s);
  }

  // Two marketplaces can ship a skill of the same name; keep the first and
  // let the id carry the source so the user can still tell them apart.
  const seen = new Set<string>();
  return all
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
