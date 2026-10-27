const messages: Record<string, string> = {
  SPEECH_DEPENDENCY_MISSING: '语音推理依赖未安装，请按语音创作开发说明安装 audio 依赖。',
  SPEECH_RESOURCES_INCOMPLETE: '模型缺少完整的 tokenizer 或语音 codec，请重新下载完整模型。',
  SPEECH_CODEC_ENCODER_MISSING: '此模型缺少参考声音编码器，无法进行克隆。',
  SPEECH_ADAPTER_VERSION_MISMATCH: '语音依赖版本不匹配，需要 mlx-audio 0.5.9。',
  SPEECH_MEMORY_EXHAUSTED: '内存不足，请关闭其他高内存应用，或选择较小的语音模型。',
  AUDIO_STORAGE_FULL: '磁盘空间不足，请清理空间后重新生成。',
  SPEECH_OUTPUT_TRUNCATED: '文字超出本次生成长度，请缩短内容后重试。',
}
export function audioFailure(code: string | null): string {
  return code && messages[code]
    ? messages[code]
    : `语音生成失败（${code ?? '未知错误'}），请检查模型和参考音频。`
}
