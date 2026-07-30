// SFX 보관함 — 만든 소리(sfxr 파라미터)를 localStorage에 저장한다.
// SFX 생성기(저장/불러오기)와 칩튠 작곡기(악기 목록)가 공유한다.

import { defaultParams, type SfxParams } from './sfx-synth.ts';

export interface StoredSound {
  id: string;
  name: string;
  params: SfxParams;
}

const STORAGE_KEY = 'killterm-sfx-sounds';

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 저장된 소리 목록. 항목이 깨져 있으면 조용히 걸러내고 기본값으로 보강한다. */
export function listSounds(): StoredSound[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          item.params &&
          typeof item.params === 'object',
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        // 이후 파라미터가 추가되어도 옛 저장본이 동작하도록 기본값 위에 덮는다
        params: { ...defaultParams(), ...item.params },
      }));
  } catch {
    return [];
  }
}

function persist(sounds: StoredSound[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sounds));
}

export function saveSound(name: string, params: SfxParams): StoredSound {
  const sounds = listSounds();
  const sound: StoredSound = { id: generateId(), name, params: { ...params } };
  sounds.push(sound);
  persist(sounds);
  return sound;
}

export function deleteSound(id: string): void {
  persist(listSounds().filter((sound) => sound.id !== id));
}
