# DXF Viewer Component

A high-performance DXF viewer component for React, based on Canvas 2D.

## Usage as a Library

### Installation

```bash
npm install @zhangly1403/dxfviewer
# or
yarn add @zhangly1403/dxfviewer
```

### Basic Example

```tsx
import React from 'react';
import { DxfViewerMain } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewerMain 
        defaultLanguage="en"
        showOpenMenu={true}
        onLoad={(data) => console.log('DXF loaded:', data)}
        onError={(err) => console.error('Error:', err)}
      />
    </div>
  );
}
```

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `defaultLanguage` | `'en' \| 'zh'` | `'zh'` | Default UI language |
| `showOpenMenu` | `boolean` | `true` | Whether to show the "Open File" menu item |
| `initFiles` | `string \| File` | `undefined` | Initial DXF file URL or File object to load |
| `onLoad` | `(data: any) => void` | `undefined` | Callback when DXF data is successfully loaded |
| `onError` | `(err: Error) => void` | `undefined` | Callback when an error occurs during loading or parsing |

---

# DXF 查看器组件

一个基于 Canvas 2D 的高性能 React DXF 查看器组件。

## 作为库使用

### 安装

```bash
npm install @zhangly1403/dxfviewer
# 或者
yarn add @zhangly1403/dxfviewer
```

### 基础示例

```tsx
import React from 'react';
import { DxfViewerMain } from '@zhangly1403/dxfviewer';
import '@zhangly1403/dxfviewer/style.css';

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <DxfViewerMain 
        defaultLanguage="zh"
        showOpenMenu={true}
        onLoad={(data) => console.log('DXF 加载成功:', data)}
        onError={(err) => console.error('加载失败:', err)}
      />
    </div>
  );
}
```

### 属性 (Props)

| 属性名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `defaultLanguage` | `'en' \| 'zh'` | `'zh'` | 默认界面语言 |
| `showOpenMenu` | `boolean` | `true` | 是否显示“打开文件”菜单项 |
| `initFiles` | `string \| File` | `undefined` | 初始加载的 DXF 文件 URL 或 File 对象 |
| `onLoad` | `(data: any) => void` | `undefined` | DXF 数据加载成功后的回调 |
| `onError` | `(err: Error) => void` | `undefined` | 加载或解析出错时的回调 |
