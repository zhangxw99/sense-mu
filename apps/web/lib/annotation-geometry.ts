// 标注画布几何纯函数：object-fit: contain 下图片实际显示区域占画布的百分比。
// 框的坐标以图片为基准（百分比），渲染时挂到该区域内即可随画布缩放自动对齐。

export type ContainFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function containFramePercentages(
  canvasWidth: number,
  canvasHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): ContainFrame | null {
  if (![canvasWidth, canvasHeight, naturalWidth, naturalHeight].every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const canvasRatio = canvasWidth / canvasHeight;
  const imageRatio = naturalWidth / naturalHeight;
  // 图片相对更宽（ratio 更大）：宽度撑满，高度按比例收缩并上下居中；反之左右居中。
  const width = imageRatio >= canvasRatio
    ? 100
    : ((canvasHeight * imageRatio) / canvasWidth) * 100;
  const height = imageRatio >= canvasRatio
    ? ((canvasWidth / imageRatio) / canvasHeight) * 100
    : 100;
  return {
    left: (100 - width) / 2,
    top: (100 - height) / 2,
    width,
    height,
  };
}
