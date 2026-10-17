// Send and Download：推断保存文件名

/** 根据 Content-Type 获取文件扩展名，未知类型返回空字符串 */
export const getExtensionFromContentType = (contentType: string): string => {
  if (!contentType) return '';

  const mimeType = contentType.split(';')[0].trim().toLowerCase();
  const mimeToExt: Record<string, string> = {
    // 文档
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',

    // 图片
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',

    // 音视频
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'video/mp4': '.mp4',
    'video/mpeg': '.mpeg',
    'video/webm': '.webm',
    'video/ogg': '.ogv',

    // 压缩文件
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar',
    'application/x-7z-compressed': '.7z',
    'application/x-tar': '.tar',
    'application/gzip': '.gz',

    // 文本
    'text/plain': '.txt',
    'text/html': '.html',
    'text/css': '.css',
    'text/javascript': '.js',
    'text/csv': '.csv',
    'text/xml': '.xml',
    'application/json': '.json',
    'application/xml': '.xml',

    // 其他
    'application/octet-stream': '.bin'
  };

  return mimeToExt[mimeType] || '';
};

/**
 * 推断下载文件名：优先用 Content-Disposition，其次用 URL 路径的最后一段，
 * 都没有时用 "download" 加上按 Content-Type 推断的扩展名。
 */
export const suggestDownloadFileName = (headers: Record<string, string>, url: string, contentType: string): string => {
  // 支持 filename="a.pdf"、filename=a.pdf、filename*=UTF-8''a.pdf
  const contentDisposition = headers['content-disposition'] || '';
  const fileNameMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i);
  if (fileNameMatch && fileNameMatch[1]) {
    return decodeURIComponent(fileNameMatch[1].trim());
  }

  const extension = getExtensionFromContentType(contentType);
  try {
    const urlPath = new URL(url).pathname;
    const urlFileName = decodeURIComponent(urlPath.substring(urlPath.lastIndexOf('/') + 1));
    if (urlFileName && urlFileName.includes('.')) return urlFileName;
    if (urlFileName) return `${urlFileName}${extension}`;
  } catch {
    // URL 无法解析时使用默认文件名
  }
  return `download${extension}`;
};
