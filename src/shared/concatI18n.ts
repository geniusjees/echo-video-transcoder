export type SupportedLocale =
  | 'zh-CN'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'en'
  | 'fr'
  | 'es'
  | 'pt'
  | 'de'
  | 'it';

const dict: Record<SupportedLocale, { same: string; mismatch: string; title: string; message: string; overwrite: string; rename: string; cancel: string }> = {
  'zh-CN': {
    same: '参数一致 → 纯拼接（硬切直连，-c copy）',
    mismatch: '分辨率不一致（{{fromW}}×{{fromH}} vs {{toW}}×{{toH}}） → 转码对齐（统一 {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}}）',
    title: '输出文件已存在',
    message: '目标文件已存在：{{name}}\n请选择处理方式。',
    overwrite: '覆盖',
    rename: '重命名',
    cancel: '取消'
  },
  'zh-TW': {
    same: '參數一致 → 純拼接（硬切直連，-c copy）',
    mismatch: '解析度不一致（{{fromW}}×{{fromH}} vs {{toW}}×{{toH}}） → 轉碼對齊（統一 {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}}）',
    title: '輸出檔案已存在',
    message: '目標檔案已存在：{{name}}\n請選擇處理方式。',
    overwrite: '覆蓋',
    rename: '重新命名',
    cancel: '取消'
  },
  ja: {
    same: 'パラメータが一致 → そのまま結合（ハードカット直結、-c copy）',
    mismatch: '解像度が一致していません（{{fromW}}×{{fromH}} vs {{toW}}×{{toH}}） → トランスコードで揃えて結合（統一 {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}}）',
    title: '出力ファイルが既に存在します',
    message: '対象ファイルはすでに存在します：{{name}}\n処理方法を選択してください。',
    overwrite: '上書き',
    rename: '名前を変更',
    cancel: 'キャンセル'
  },
  ko: {
    same: '매개변수가 일치 → 단순 병합（하드 컷 직결, -c copy）',
    mismatch: '해상도가 일치하지 않습니다（{{fromW}}×{{fromH}} vs {{toW}}×{{toH}}） → 재인코딩으로 맞춘 후 병합（{{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}} 통일）',
    title: '출력 파일이 이미 존재합니다',
    message: '대상 파일이 이미 존재합니다: {{name}}\n처리 방식을 선택하세요.',
    overwrite: '덮어쓰기',
    rename: '이름 바꾸기',
    cancel: '취소'
  },
  en: {
    same: 'Parameters match → direct merge (hard cut, -c copy)',
    mismatch: 'Resolution mismatch ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → re-encode to align (uniform {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'Output file already exists',
    message: 'Target file already exists: {{name}}\nPlease choose how to proceed.',
    overwrite: 'Overwrite',
    rename: 'Rename',
    cancel: 'Cancel'
  },
  fr: {
    same: 'Paramètres identiques → assemblage direct (coupes nettes, -c copy)',
    mismatch: 'Résolution incohérente ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → réencodage pour aligner (uniforme {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'Le fichier de sortie existe déjà',
    message: 'Le fichier cible existe déjà : {{name}}\nChoisissez la méthode à appliquer.',
    overwrite: 'Remplacer',
    rename: 'Renommer',
    cancel: 'Annuler'
  },
  es: {
    same: 'Los parámetros coinciden → unión directa (cortes duros, -c copy)',
    mismatch: 'Resolución inconsistente ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → recodificar para alinear (uniforme {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'El archivo de salida ya existe',
    message: 'El archivo objetivo ya existe: {{name}}\nElija cómo continuar.',
    overwrite: 'Sobrescribir',
    rename: 'Renombrar',
    cancel: 'Cancelar'
  },
  pt: {
    same: 'Os parâmetros coincidem → junção direta (cortes diretos, -c copy)',
    mismatch: 'Resolução inconsistente ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → recodificar para alinhar (uniforme {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'O arquivo de saída já existe',
    message: 'O arquivo de destino já existe: {{name}}\nEscolha como continuar.',
    overwrite: 'Sobrescrever',
    rename: 'Renomear',
    cancel: 'Cancelar'
  },
  de: {
    same: 'Parameter stimmen überein → Direkte Zusammenführung (harte Schnitte, -c copy)',
    mismatch: 'Auflösung stimmt nicht überein ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → neu kodieren und angleichen (einheitlich {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'Ausgabedatei existiert bereits',
    message: 'Zieldatei existiert bereits: {{name}}\nBitte wählen Sie die Vorgehensweise aus.',
    overwrite: 'Überschreiben',
    rename: 'Umbenennen',
    cancel: 'Abbrechen'
  },
  it: {
    same: 'I parametri corrispondono → unione diretta (tagli netti, -c copy)',
    mismatch: 'Risoluzione non uniforme ({{fromW}}×{{fromH}} vs {{toW}}×{{toH}}) → ricodifica per allineare (uniforme {{res}}p / {{fps}}fps / {{bitrate}}Mbps / {{codec}})',
    title: 'Il file di output esiste già',
    message: 'Il file di destinazione esiste già: {{name}}\nScegliere l’azione da eseguire.',
    overwrite: 'Sovrascrivi',
    rename: 'Rinomina',
    cancel: 'Annulla'
  }
};

export function resolveConcatLocale(raw?: string | null): SupportedLocale {
  const tag = String(raw ?? 'en').replace(/_/g, '-').toLowerCase();
  const exact = [
    'zh-cn',
    'zh-tw',
    'ja',
    'ko',
    'en',
    'fr',
    'es',
    'pt',
    'de',
    'it'
  ].find((code) => code === tag);
  if (exact) {
    return exact === 'zh-cn' ? 'zh-CN' : exact === 'zh-tw' ? 'zh-TW' : (exact as SupportedLocale);
  }
  const [lang] = tag.split('-');
  if (lang === 'zh') return /hant|tw|hk|mo/.test(tag) ? 'zh-TW' : 'zh-CN';
  const byLang: Partial<Record<string, SupportedLocale>> = {
    ja: 'ja',
    ko: 'ko',
    en: 'en',
    fr: 'fr',
    es: 'es',
    pt: 'pt',
    de: 'de',
    it: 'it'
  };
  return byLang[lang] ?? 'en';
}

export function resolveConcatDialogLocale(language?: string | null, fallbackLocale?: string | null): SupportedLocale {
  const selected = language && language !== 'auto' ? language : (fallbackLocale ?? 'en');
  return resolveConcatLocale(selected);
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

export function formatConcatReason(locale: string | undefined, args: {
  equal: boolean;
  fromW?: number;
  fromH?: number;
  toW?: number;
  toH?: number;
  res?: number;
  fps?: number;
  bitrate?: number;
  codec?: string;
}): string {
  const loc = resolveConcatDialogLocale(locale);
  const text = args.equal ? dict[loc].same : fill(dict[loc].mismatch, {
    fromW: args.fromW ?? 0,
    fromH: args.fromH ?? 0,
    toW: args.toW ?? 0,
    toH: args.toH ?? 0,
    res: args.res ?? 0,
    fps: args.fps ?? 0,
    bitrate: args.bitrate ?? 0,
    codec: (args.codec ?? '').toUpperCase()
  });
  return text;
}

export function formatConcatConflictPrompt(locale: string | undefined, fileName: string): {
  title: string;
  message: string;
  buttons: string[];
} {
  const loc = resolveConcatDialogLocale(locale);
  return {
    title: dict[loc].title,
    message: fill(dict[loc].message, { name: fileName }),
    buttons: [dict[loc].overwrite, dict[loc].rename, dict[loc].cancel]
  };
}

export function formatConcatCancelMessage(locale: string | undefined): string {
  const loc = resolveConcatDialogLocale(locale);
  return dict[loc].cancel;
}
