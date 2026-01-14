# DXF Viewer

一个基于 React 和 HTML5 Canvas 的高性能 DXF 文件查看器。

## 安装

```bash
npm install dxfviewer
```

## 使用方法

### 基本调用

```tsx
import React from 'react';
import { DxfViewerMain } from 'dxfviewer';

const App = () => {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewerMain 
        initFiles="/path/to/your/file.dxf" // 支持 URL 或 File 对象
        showOpenMenu={true}
        onLoad={(data) => console.log('加载成功:', data)}
        onError={(err) => console.error('加载失败:', err)}
      />
    </div>
  );
};

export default App;
```

## Props 参数说明

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `initFiles` | `string \| File` | `undefined` | 初始加载的文件，支持远程 URL 字符串或本地 File 对象。 |
| `showOpenMenu` | `boolean` | `true` | 是否显示工具栏中的“打开文件”按钮。 |
| `onLoad` | `(data: any) => void` | `undefined` | 文件解析成功后的回调，返回解析后的 DXF 数据。 |
| `onError` | `(err: Error) => void` | `undefined` | 解析过程中出现错误的回调函数。 |

## 主要功能调用

组件内部会自动处理：
- **文件解析**：自动识别并解析 DXF 实体、图层、块和样式。
- **自动适配**：加载后自动调用 `fitView` 充满视口。
- **极大坐标支持**：内部优化了针对 AutoCAD 极大坐标的渲染精度。
- **交互支持**：支持鼠标滚轮缩放、左键平移、框选和点击选择。
