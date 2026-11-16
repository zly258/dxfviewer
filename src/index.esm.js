/**
 * @license MIT
 * three-dxf-loader (ES Module Entry)
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
import * as THREE from 'three';
import umdFactory from './DXFLoader.js';

const DXFLoader = (typeof umdFactory === 'function' && !umdFactory.prototype)
  ? umdFactory(THREE)
  : (THREE.DXFLoader || umdFactory);

export { DXFLoader };
export default DXFLoader;
