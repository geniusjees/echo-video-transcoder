/**
 * 输出路径工具（渲染进程）
 * 实现在 `@shared/outputPath`，与主进程共用同一套规则。
 */
export {
  makeOutputPath,
  baseName,
  outputFileName,
  resolveSuffix,
  validateSuffix,
  MAX_SUFFIX_LENGTH
} from '@shared/outputPath';
export type { OutputNamingOptions, SuffixValidation, SuffixErrorCode } from '@shared/outputPath';
