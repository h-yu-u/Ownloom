export function imageJobError(code: string | null): string {
  const messages: Record<string, string> = {
    MODEL_LOAD_FAILED: '生图模型加载失败，请确认对应引擎已安装、模型文件完整且格式受支持。',
    RUNTIME_RESTARTED: '应用重启中断了此次生成，可以复用参数重新生成。',
    RUNTIME_SHUTDOWN: '应用关闭中断了此次生成，可以复用参数重新生成。',
    IMAGE_GENERATION_FAILED: '图片生成失败，请检查模型与参数后重试。',
  }
  return messages[code ?? ''] ?? '图片生成失败，请检查模型与参数后重试。'
}

export const validationMessages: Record<string, string> = {
  IMAGE_MODEL_REQUIRED: '请先选择生图模型',
  IMAGE_PROMPT_INVALID: '请输入不超过 10,000 字的提示词',
  IMAGE_DIMENSIONS_INVALID: '宽高须在 64–2048 之间，且为 16 的倍数',
  IMAGE_STEPS_INVALID: '步数须在 1–100 之间',
  IMAGE_SEED_INVALID: 'Seed 须为 0–4294967295 的整数，留空则随机生成',
  IMAGE_REFERENCE_REQUIRED: '请上传 1–10 张不重复的参考图',
  IMAGE_MASK_REQUIRED: '请先涂抹需要修改的区域',
  IMAGE_EDIT_DIMENSIONS_INVALID: '编辑图片时，宽高须为 32 的倍数',
  IMAGE_EDIT_PARAMETERS_INVALID: '修改强度须大于 0 且不超过 100%',
}
