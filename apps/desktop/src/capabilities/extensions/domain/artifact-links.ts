export function artifactLinks(value: unknown): { id: string; label: string; path: string }[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('artifactRefs' in value) ||
    !Array.isArray(value.artifactRefs)
  )
    return []
  return value.artifactRefs.slice(0, 8).flatMap((item: unknown) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('kind' in item) ||
      !('id' in item) ||
      typeof item.id !== 'string' ||
      !['image', 'audio'].includes(String(item.kind))
    )
      return []
    return [
      {
        id: item.id,
        label: item.kind === 'image' ? '查看图片作品' : '查看语音作品',
        path: `/${item.kind === 'image' ? 'image-studio' : 'audio-studio'}?artifactId=${encodeURIComponent(item.id)}`,
      },
    ]
  })
}
