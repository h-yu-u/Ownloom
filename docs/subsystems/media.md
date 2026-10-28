# 图片与语音子系统

[子系统目录](./README.md) · [使用手册](../reference.md) · [Runtime](./runtime.md)

## 职责与边界

图片和语音工作区分别负责创作草稿、提交、任务观察及历史恢复；共享媒体能力负责资源选择、认证读取和有界缓存。Runtime 拥有生成任务、文件校验和作品登记，Worker 只运行引擎。播放/预览结束与取消后台生成是不同操作。

| 事实来源                                                                                           | 维护内容                                     |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [图片工作区](../../apps/desktop/src/modules/image-studio/)                                         | 提示词、参考顺序、蒙版、比较、历史与参数复用 |
| [语音工作区](../../apps/desktop/src/modules/audio-studio/)                                         | 合成、音色库、播放器、历史与参数复用         |
| [共享媒体能力](../../apps/desktop/src/capabilities/media/)                                         | 作品选择、认证 Blob、可见性和缓存回收        |
| [图片领域参数](../../services/runtime/src/mlx_studio_runtime/domain/image_generation.py)           | 请求校验与编辑参数                           |
| [语音领域参数](../../services/runtime/src/mlx_studio_runtime/domain/speech.py)                     | 模式、长度、能力与错误                       |
| [图片用例](../../services/runtime/src/mlx_studio_runtime/application/image_generation_service.py)  | 调度、附件快照、完成事务和补偿               |
| [语音用例](../../services/runtime/src/mlx_studio_runtime/application/speech_generation_service.py) | 冻结音色、生成、终态和文件登记               |
| [音色用例](../../services/runtime/src/mlx_studio_runtime/application/voice_profile_service.py)     | 参考素材、授权记录与引用保护                 |

## 图片运行路径

提交先冻结模型、参数、参考图次序及蒙版身份，再由 Runtime 接纳任务，排队取得推理租约。MFLUX 适配器从完整本地资源加载，生成 PNG 后由 Supervisor 校验并提交作品。只有完成事务成功后，任务才对外成功；失败或取消清理未提交文件。

当前通用参数接受宽高 64–2048 且为 16 的倍数、步数 1–100；具体引擎可能进一步收紧。例如完整 Qwen Image 编辑管线要求宽高为 32 的倍数。参数合法不证明某模型在该分辨率和硬件上已验证。

图片编辑最多 10 张参考输入，每张最多 20 MiB。图 1 是原图；改变原图需清除旧蒙版绑定。蒙版、参考输入和模型快照随作品保留，不能依赖页面仍持有临时 URL。继续编辑把结果作为新原图，复用参数恢复原任务输入；缺失资源必须提示。

引擎实现见 [MFLUX 适配器](../../services/runtime/src/mlx_studio_runtime/adapters/image_engines/mflux_image.py)，文件处理见 [image_files.py](../../services/runtime/src/mlx_studio_runtime/adapters/image_files.py)。蒙版外固定像素不保证接缝自然或所有任务符合语义，质量必须检查实际产物。

## 语音运行路径

预设合成使用 CustomVoice，参考克隆使用 Base。模型能力包含语言、speaker、参考资源要求和静态验证状态；未知模式或参数明确拒绝，不尝试隐藏的上游能力。

参考上传检查 RIFF/WAVE、16 位 PCM、实际帧数、采样率、声道、时长、大小、截断和全静音。单次朗读最多 2000 字；参考为 0.1–30 秒、8–96 kHz、单/双声道、最多 12 MiB。提交时冻结音色版本、参考原文、素材来源及授权记录，后续编辑不改变已排队任务。

[Qwen3-TTS 适配器](../../services/runtime/src/mlx_studio_runtime/adapters/audio_engines/qwen3_tts.py)延迟加载当前固定版本 `mlx-audio`，只使用本地资源。WAV 写入受管目录，Supervisor 再校验后登记。NDJSON 传状态和元数据，不内嵌音频。当前没有录音、自动转写、声音设计、实时音频流或长文分段编辑。

音色、参考录音和历史作品分别删除，需尊重引用关系。未完成任务使用的录音受保护；删除音色不能连带删除已生成作品。文件验证见 [audio_files.py](../../services/runtime/src/mlx_studio_runtime/adapters/audio_files.py)。

## 状态、恢复与导出

- 图片、语音、聊天和 Coding 推理共用单活 Worker。离页释放观察及播放资源，后台任务继续。
- Runtime 重启将未完成任务标记为中断/失败，不跨进程续算；已提交作品可从历史读取。
- 列表、详情、文件分别处理错误。详情按 ID 读取，不要求作品出现在当前分页；分页失败不清空已有内容。
- 参数恢复发现模型、音色、语言、speaker、附件或蒙版变化时给出可见结果。期间用户改过草稿，迟到结果保留为候选，不覆盖编辑。
- 按可见性获取缩略图，原图单独缓存。Blob URL 在离页、连接失效或淘汰时释放；认证 Token 不出现在媒体 URL 中。
- 桌面导出经平台保存对话框及 Rust 原子写入，普通二进制导出最多 64 MiB；取消不落文件，失败不能提示成功。备份走独立流式路径，见[存储](./storage.md)。

## 验证与维护

依赖、生成和测试命令详见[开发指南](../development.md)：

```bash
pnpm generate api
pnpm test frontend
pnpm test runtime
pnpm build web
```

重点覆盖[图片工作区](../../tests/test_image_studio.py)、[图片编辑](../../tests/test_image_editing.py)、[语音工作区](../../tests/test_audio_studio.py)、[语音引擎](../../tests/test_audio_engines.py)及前端历史、恢复、缓存和取消。断言产物可解码、元数据/终态一致、取消后没有成功作品；不对不确定生成结果做跨版本像素或完整文本相等断言。

真实探针为 [verify_local_image.py](../../scripts/verify/verify_local_image.py)、[verify_local_edit.py](../../scripts/verify/verify_local_edit.py)、[verify_local_speech.py](../../scripts/verify/verify_local_speech.py)、[verify_speech_quality.py](../../scripts/verify/verify_speech_quality.py)。包内命令及记录约定见[发布验收](../release-acceptance.md)。帧数、能量和削波只证明信号特征，不能代替自然度、发音或音色相似度人工评价。

引擎依赖变化需同步锁文件、Sidecar 收集规则和固定模型复验；作品格式变化需验证重启、缺失文件、引用保护和恢复。证据及未验证范围统一见[验证范围](../verification.md)。
