import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateSuffix,
  type OutputNamingOptions,
  type SuffixValidation
} from '@shared/outputPath';
import { useConfigStore } from '../stores/configStore';

/** 使用同一套命名设置的页面（各自独立保存） */
export type NamingScope = 'transcode' | 'edit' | 'rotate';

interface NamingPatch {
  appendSuffix?: boolean;
  suffix?: string;
  outputSameAsSource?: boolean;
}

export interface OutputNamingState {
  /** 传给 makeOutputPath 的命名规则 */
  naming: OutputNamingOptions;
  appendSuffix: boolean;
  sameAsSource: boolean;
  /** 后缀输入框的当前文本（含未落盘的草稿） */
  suffixDraft: string;
  validation: SuffixValidation;
  /** 勾选了后缀但内容非法 → 不允许开始 */
  invalid: boolean;
  /** 与原文件同目录且无后缀 → 覆盖原文件 */
  willOverwrite: boolean;
  setAppendSuffix: (v: boolean) => void;
  setSameAsSource: (v: boolean) => void;
  onSuffixChange: (v: string) => void;
}

const DEFAULT_SUFFIX: Record<NamingScope, string> = {
  transcode: '_out',
  edit: '_edited',
  rotate: '_rotated'
};

/**
 * 输出命名设置（转码页 / 编辑页共用同一套逻辑）：
 * - 「是否添加后缀」+ ≤16 字符的自定义后缀（跨平台文件名规则校验）
 * - 「与原文件同一文件夹」→ 每个文件输出到各自源目录；无后缀即覆盖原文件
 *
 * 后缀输入用本地草稿 + 400ms 防抖落盘：避免每个字符都写一次配置文件，
 * 也避免连续输入时后一次保存读到过期配置而丢字。
 */
export function useOutputNaming(scope: NamingScope): OutputNamingState {
  const config = useConfigStore((s) => s.config);
  const setTranscodeConfig = useConfigStore((s) => s.setTranscodeConfig);
  const setEditConfig = useConfigStore((s) => s.setEditConfig);
  const setRotateConfig = useConfigStore((s) => s.setRotateConfig);

  const section =
    scope === 'edit' ? config?.edit : scope === 'rotate' ? config?.rotate : config?.transcode;
  const appendSuffix = section?.appendSuffix ?? true;
  const sameAsSource = section?.outputSameAsSource ?? false;
  const cfgSuffix = section?.suffix ?? DEFAULT_SUFFIX[scope];

  const [suffixDraft, setSuffixDraft] = useState(cfgSuffix);
  const dirty = useRef(false);

  // 外部改动（配置加载等）时同步回输入框；用户正在输入则不打断
  useEffect(() => {
    if (!dirty.current) setSuffixDraft(cfgSuffix);
  }, [cfgSuffix]);

  /** 按页写入各自的配置段 */
  const patch = useCallback(
    (p: NamingPatch) => {
      if (scope === 'edit') void setEditConfig(p);
      else if (scope === 'rotate') void setRotateConfig(p);
      else void setTranscodeConfig(p);
    },
    [scope, setEditConfig, setRotateConfig, setTranscodeConfig]
  );

  // 停止输入 400ms 后落盘
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      dirty.current = false;
      patch({ suffix: suffixDraft });
    }, 400);
    return () => clearTimeout(timer);
  }, [suffixDraft, patch]);

  const naming = useMemo<OutputNamingOptions>(
    () => ({ appendSuffix, suffix: suffixDraft, sameAsSource }),
    [appendSuffix, suffixDraft, sameAsSource]
  );

  const validation = useMemo(() => validateSuffix(suffixDraft), [suffixDraft]);

  const setAppendSuffix = useCallback((v: boolean) => patch({ appendSuffix: v }), [patch]);
  const setSameAsSource = useCallback((v: boolean) => patch({ outputSameAsSource: v }), [patch]);
  const onSuffixChange = useCallback((v: string) => {
    dirty.current = true;
    setSuffixDraft(v);
  }, []);

  return {
    naming,
    appendSuffix,
    sameAsSource,
    suffixDraft,
    validation,
    invalid: appendSuffix && !validation.ok,
    willOverwrite: sameAsSource && !appendSuffix,
    setAppendSuffix,
    setSameAsSource,
    onSuffixChange
  };
}
