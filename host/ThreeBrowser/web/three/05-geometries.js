(function (TN) {
  "use strict";

  const BufferGeometry = TN.BufferGeometry;
  const Float32BufferAttribute = TN.Float32BufferAttribute;
  const Vector2 = TN.Vector2;
  const Vector3 = TN.Vector3;

  // Mesh uploads via BufferGeometryCreate; do not call native geometry create APIs here.

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function geometryCopy(source) {
    BufferGeometry.prototype.copy.call(this, source);
    this.parameters = Object.assign({}, source.parameters);
    return this;
  }

  function computeVertexNormals(geo) {
    if (typeof geo.computeVertexNormals === "function") {
      geo.computeVertexNormals();
      return geo;
    }
    const pos = geo.getAttribute("position");
    if (!pos) return geo;
    const normals = new Float32Array(pos.count * 3);
    const index = geo.index;
    const pA = new Vector3();
    const pB = new Vector3();
    const pC = new Vector3();
    const cb = new Vector3();
    const ab = new Vector3();
    function addFace(i0, i1, i2) {
      pA.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
      pB.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
      pC.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
      cb.subVectors(pC, pB);
      ab.subVectors(pA, pB);
      cb.cross(ab);
      const nx = cb.x;
      const ny = cb.y;
      const nz = cb.z;
      normals[i0 * 3] += nx;
      normals[i0 * 3 + 1] += ny;
      normals[i0 * 3 + 2] += nz;
      normals[i1 * 3] += nx;
      normals[i1 * 3 + 1] += ny;
      normals[i1 * 3 + 2] += nz;
      normals[i2 * 3] += nx;
      normals[i2 * 3 + 1] += ny;
      normals[i2 * 3 + 2] += nz;
    }
    if (index) {
      for (let i = 0, il = index.count; i < il; i += 3) {
        addFace(index.getX(i), index.getX(i + 1), index.getX(i + 2));
      }
    } else {
      for (let i = 0, il = pos.count; i < il; i += 3) addFace(i, i + 1, i + 2);
    }
    for (let i = 0; i < pos.count; i++) {
      const x = normals[i * 3];
      const y = normals[i * 3 + 1];
      const z = normals[i * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    }
    geo.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    return geo;
  }

  function normalizeNormals(geo) {
    if (typeof geo.normalizeNormals === "function") {
      geo.normalizeNormals();
      return geo;
    }
    const normals = geo.attributes.normal;
    if (!normals) return geo;
    for (let i = 0, il = normals.count; i < il; i++) {
      const x = normals.getX(i);
      const y = normals.getY(i);
      const z = normals.getZ(i);
      const len = Math.hypot(x, y, z) || 1;
      const a = normals.array;
      const s = i * normals.itemSize;
      a[s] = x / len;
      a[s + 1] = y / len;
      a[s + 2] = z / len;
    }
    return geo;
  }

  function shapeArea(contour) {
    const n = contour.length;
    let a = 0;
    for (let p = n - 1, q = 0; q < n; p = q++) {
      a += contour[p].x * contour[q].y - contour[q].x * contour[p].y;
    }
    return a * 0.5;
  }

  function isClockWise(pts) {
    if (TN.ShapeUtils && typeof TN.ShapeUtils.isClockWise === "function") {
      return TN.ShapeUtils.isClockWise(pts);
    }
    return shapeArea(pts) < 0;
  }

  function removeDupEndPts(points) {
    const l = points.length;
    if (l > 2 && points[l - 1].x === points[0].x && points[l - 1].y === points[0].y) {
      points.pop();
    }
  }

  function cross2(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(d) < 1e-14) return false;
    const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
    const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
    const wc = 1 - wa - wb;
    return wa >= -1e-12 && wb >= -1e-12 && wc >= -1e-12;
  }

  function earClip(pts, idx) {
    const faces = [];
    if (idx.length < 3) return faces;
    let area = 0;
    for (let i = 0, n = idx.length, j = n - 1; i < n; j = i++) {
      const p = pts[idx[j]];
      const q = pts[idx[i]];
      area += p.x * q.y - q.x * p.y;
    }
    const ring = idx.slice();
    if (area < 0) ring.reverse();
    let guard = 0;
    const max = ring.length * ring.length;
    while (ring.length > 3 && guard++ < max) {
      let clipped = false;
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const i0 = ring[(i + n - 1) % n];
        const i1 = ring[i];
        const i2 = ring[(i + 1) % n];
        const a = pts[i0];
        const b = pts[i1];
        const c = pts[i2];
        if (cross2(a.x, a.y, b.x, b.y, c.x, c.y) <= 1e-12) continue;
        let inside = false;
        for (let k = 0; k < n; k++) {
          const ii = ring[k];
          if (ii === i0 || ii === i1 || ii === i2) continue;
          const p = pts[ii];
          if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y)) {
            inside = true;
            break;
          }
        }
        if (inside) continue;
        faces.push([i0, i1, i2]);
        ring.splice(i, 1);
        clipped = true;
        break;
      }
      if (!clipped) break;
    }
    if (ring.length === 3) faces.push([ring[0], ring[1], ring[2]]);
    return faces;
  }

  function bridgeHole(outerIdx, holeIdx, pts) {
    let hi = 0;
    for (let i = 1; i < holeIdx.length; i++) {
      if (pts[holeIdx[i]].x > pts[holeIdx[hi]].x) hi = i;
    }
    const hp = pts[holeIdx[hi]];
    let oi = 0;
    let best = Infinity;
    for (let i = 0; i < outerIdx.length; i++) {
      const p = pts[outerIdx[i]];
      const dx = p.x - hp.x;
      const dy = p.y - hp.y;
      const d = dx * dx + dy * dy;
      if (p.x >= hp.x - 1e-12 && d < best) {
        best = d;
        oi = i;
      }
    }
    const holeWalk = [];
    for (let i = 0; i < holeIdx.length; i++) holeWalk.push(holeIdx[(hi + i) % holeIdx.length]);
    return outerIdx
      .slice(0, oi + 1)
      .concat(holeWalk, [holeWalk[0], outerIdx[oi]], outerIdx.slice(oi + 1));
  }

  function triangulateShape(contour, holes) {
    if (TN.ShapeUtils && typeof TN.ShapeUtils.triangulateShape === "function") {
      return TN.ShapeUtils.triangulateShape(contour, holes);
    }
    removeDupEndPts(contour);
    const pts = contour.slice();
    const holeList = holes || [];
    holeList.forEach(removeDupEndPts);
    const holeStarts = [];
    for (let h = 0; h < holeList.length; h++) {
      holeStarts.push(pts.length);
      for (let i = 0; i < holeList[h].length; i++) pts.push(holeList[h][i]);
    }
    let idx = [];
    for (let i = 0; i < contour.length; i++) idx.push(i);
    for (let h = 0; h < holeList.length; h++) {
      const holeIdx = [];
      for (let i = 0; i < holeList[h].length; i++) holeIdx.push(holeStarts[h] + i);
      idx = bridgeHole(idx, holeIdx, pts);
    }
    return earClip(pts, idx);
  }

  function isPointList(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const p = arr[0];
    return !!(p && typeof p.x === "number" && !p.extractPoints && !p.getPoints && !p.isShape);
  }

  function extractShapePoints(shape, curveSegments) {
    if (!shape) return { shape: [], holes: [] };
    if (typeof shape.extractPoints === "function") return shape.extractPoints(curveSegments);
    if (typeof shape.getPoints === "function") {
      const holes = [];
      const src = shape.holes || [];
      for (let i = 0; i < src.length; i++) {
        const h = src[i];
        holes.push(typeof h.getPoints === "function" ? h.getPoints(curveSegments) : h);
      }
      return { shape: shape.getPoints(curveSegments), holes };
    }
    if (Array.isArray(shape)) return { shape: shape, holes: [] };
    return { shape: [], holes: [] };
  }

  function rotateAroundAxis(v, axis, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const kx = axis.x;
    const ky = axis.y;
    const kz = axis.z;
    const x = v.x;
    const y = v.y;
    const z = v.z;
    const kdot = kx * x + ky * y + kz * z;
    return v.set(
      x * c + (ky * z - kz * y) * s + kx * kdot * t,
      y * c + (kz * x - kx * z) * s + ky * kdot * t,
      z * c + (kx * y - ky * x) * s + kz * kdot * t
    );
  }

  function pathPoint(path, t, target) {
    if (path && typeof path.getPointAt === "function") {
      const r = path.getPointAt(t, target);
      if (r) {
        if (r !== target) target.copy(r);
        return target;
      }
      return target;
    }
    if (path && typeof path.getPoint === "function") {
      const r = path.getPoint(t, target);
      if (r) {
        if (r !== target) target.copy(r);
        return target;
      }
      return target;
    }
    const a = t * Math.PI * 2;
    return target.set(Math.cos(a), 0, Math.sin(a));
  }

  function pathTangentAt(path, u, target) {
    if (path && typeof path.getTangentAt === "function") {
      const r = path.getTangentAt(u, target);
      if (r) {
        if (r !== target) target.copy(r);
        return target;
      }
      return target;
    }
    const delta = 0.0001;
    const u1 = Math.max(0, u - delta);
    const u2 = Math.min(1, u + delta);
    const p1 = pathPoint(path, u1, new Vector3());
    const p2 = pathPoint(path, u2, new Vector3());
    return target.set(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z).normalize();
  }

  function computeFrenetFrames(path, segments, closed) {
    if (path && typeof path.computeFrenetFrames === "function") {
      return path.computeFrenetFrames(segments, closed);
    }
    const tangents = [];
    const normals = [];
    const binormals = [];
    const vec = new Vector3();
    const normal = new Vector3();
    for (let i = 0; i <= segments; i++) {
      tangents[i] = pathTangentAt(path, i / segments, new Vector3());
    }
    normals[0] = new Vector3();
    binormals[0] = new Vector3();
    let min = Number.MAX_VALUE;
    const tx = Math.abs(tangents[0].x);
    const ty = Math.abs(tangents[0].y);
    const tz = Math.abs(tangents[0].z);
    if (tx <= min) {
      min = tx;
      normal.set(1, 0, 0);
    }
    if (ty <= min) {
      min = ty;
      normal.set(0, 1, 0);
    }
    if (tz <= min) normal.set(0, 0, 1);
    vec.crossVectors(tangents[0], normal).normalize();
    normals[0].crossVectors(tangents[0], vec);
    binormals[0].crossVectors(tangents[0], normals[0]);
    for (let i = 1; i <= segments; i++) {
      normals[i] = normals[i - 1].clone();
      binormals[i] = binormals[i - 1].clone();
      vec.crossVectors(tangents[i - 1], tangents[i]);
      if (vec.length() > Number.EPSILON) {
        vec.normalize();
        const theta = Math.acos(clamp(tangents[i - 1].dot(tangents[i]), -1, 1));
        rotateAroundAxis(normals[i], vec, theta);
      }
      binormals[i].crossVectors(tangents[i], normals[i]);
    }
    if (closed === true) {
      let theta = Math.acos(clamp(normals[0].dot(normals[segments]), -1, 1));
      theta /= segments;
      if (tangents[0].dot(vec.crossVectors(normals[0], normals[segments])) > 0) theta = -theta;
      for (let i = 1; i <= segments; i++) {
        rotateAroundAxis(normals[i], tangents[i], theta * i);
        binormals[i].crossVectors(tangents[i], normals[i]);
      }
    }
    return { tangents, normals, binormals };
  }

  function defaultTubePath() {
    const Q = TN.QuadraticBezierCurve3;
    if (typeof Q === "function") {
      return new Q(new Vector3(-1, -1, 0), new Vector3(-1, 1, 0), new Vector3(1, 1, 0));
    }
    return {
      getPoint(t, optionalTarget) {
        const v = optionalTarget || new Vector3();
        const a = t * Math.PI * 2;
        return v.set(Math.cos(a), 0, Math.sin(a));
      },
      getPointAt(u, optionalTarget) {
        return this.getPoint(u, optionalTarget);
      },
      getTangentAt(u, optionalTarget) {
        const v = optionalTarget || new Vector3();
        const a = u * Math.PI * 2;
        return v.set(-Math.sin(a), 0, Math.cos(a));
      },
    };
  }

  class BoxGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, depth = 1, widthSegments = 1, heightSegments = 1, depthSegments = 1) {
      super();
      this.type = "BoxGeometry";
      this.parameters = { width, height, depth, widthSegments, heightSegments, depthSegments };
      widthSegments = Math.floor(widthSegments) || 1;
      heightSegments = Math.floor(heightSegments) || 1;
      depthSegments = Math.floor(depthSegments) || 1;
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      let numberOfVertices = 0;
      let groupStart = 0;
      const buildPlane = (u, v, w, udir, vdir, pWidth, pHeight, pDepth, gridX, gridY, materialIndex) => {
        const segmentWidth = pWidth / gridX;
        const segmentHeight = pHeight / gridY;
        const widthHalf = pWidth / 2;
        const heightHalf = pHeight / 2;
        const depthHalf = pDepth / 2;
        const gridX1 = gridX + 1;
        const gridY1 = gridY + 1;
        let vertexCounter = 0;
        let groupCount = 0;
        const vector = new Vector3();
        for (let iy = 0; iy < gridY1; iy++) {
          const y = iy * segmentHeight - heightHalf;
          for (let ix = 0; ix < gridX1; ix++) {
            const x = ix * segmentWidth - widthHalf;
            vector[u] = x * udir;
            vector[v] = y * vdir;
            vector[w] = depthHalf;
            vertices.push(vector.x, vector.y, vector.z);
            vector[u] = 0;
            vector[v] = 0;
            vector[w] = pDepth > 0 ? 1 : -1;
            normals.push(vector.x, vector.y, vector.z);
            uvs.push(ix / gridX);
            uvs.push(1 - iy / gridY);
            vertexCounter++;
          }
        }
        for (let iy = 0; iy < gridY; iy++) {
          for (let ix = 0; ix < gridX; ix++) {
            const a = numberOfVertices + ix + gridX1 * iy;
            const b = numberOfVertices + ix + gridX1 * (iy + 1);
            const c = numberOfVertices + (ix + 1) + gridX1 * (iy + 1);
            const d = numberOfVertices + (ix + 1) + gridX1 * iy;
            indices.push(a, b, d);
            indices.push(b, c, d);
            groupCount += 6;
          }
        }
        this.addGroup(groupStart, groupCount, materialIndex);
        groupStart += groupCount;
        numberOfVertices += vertexCounter;
      };
      buildPlane("z", "y", "x", -1, -1, depth, height, width, depthSegments, heightSegments, 0);
      buildPlane("z", "y", "x", 1, -1, depth, height, -width, depthSegments, heightSegments, 1);
      buildPlane("x", "z", "y", 1, 1, width, depth, height, widthSegments, depthSegments, 2);
      buildPlane("x", "z", "y", 1, -1, width, depth, -height, widthSegments, depthSegments, 3);
      buildPlane("x", "y", "z", 1, -1, width, height, depth, widthSegments, heightSegments, 4);
      buildPlane("x", "y", "z", -1, -1, width, height, -depth, widthSegments, heightSegments, 5);
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new BoxGeometry(data.width, data.height, data.depth, data.widthSegments, data.heightSegments, data.depthSegments);
    }
  }

  class PlaneGeometry extends BufferGeometry {
    constructor(width = 1, height = 1, widthSegments = 1, heightSegments = 1) {
      super();
      this.type = "PlaneGeometry";
      this.parameters = { width, height, widthSegments, heightSegments };
      const widthHalf = width / 2;
      const heightHalf = height / 2;
      const gridX = Math.floor(widthSegments) || 1;
      const gridY = Math.floor(heightSegments) || 1;
      const gridX1 = gridX + 1;
      const gridY1 = gridY + 1;
      const segmentWidth = width / gridX;
      const segmentHeight = height / gridY;
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      for (let iy = 0; iy < gridY1; iy++) {
        const y = iy * segmentHeight - heightHalf;
        for (let ix = 0; ix < gridX1; ix++) {
          const x = ix * segmentWidth - widthHalf;
          vertices.push(x, -y, 0);
          normals.push(0, 0, 1);
          uvs.push(ix / gridX);
          uvs.push(1 - iy / gridY);
        }
      }
      for (let iy = 0; iy < gridY; iy++) {
        for (let ix = 0; ix < gridX; ix++) {
          const a = ix + gridX1 * iy;
          const b = ix + gridX1 * (iy + 1);
          const c = ix + 1 + gridX1 * (iy + 1);
          const d = ix + 1 + gridX1 * iy;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new PlaneGeometry(data.width, data.height, data.widthSegments, data.heightSegments);
    }
  }

  class SphereGeometry extends BufferGeometry {
    constructor(radius = 1, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
      super();
      this.type = "SphereGeometry";
      this.parameters = { radius, widthSegments, heightSegments, phiStart, phiLength, thetaStart, thetaLength };
      widthSegments = Math.max(3, Math.floor(widthSegments));
      heightSegments = Math.max(2, Math.floor(heightSegments));
      const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);
      let index = 0;
      const grid = [];
      const vertex = new Vector3();
      const normal = new Vector3();
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      for (let iy = 0; iy <= heightSegments; iy++) {
        const verticesRow = [];
        const v = iy / heightSegments;
        const theta = thetaStart + v * thetaLength;
        const y = radius * Math.cos(theta);
        const ringRadius = Math.sqrt(Math.max(0, radius * radius - y * y));
        let uOffset = 0;
        if (iy === 0 && thetaStart === 0) uOffset = 0.5 / widthSegments;
        else if (iy === heightSegments && thetaEnd === Math.PI) uOffset = -0.5 / widthSegments;
        for (let ix = 0; ix <= widthSegments; ix++) {
          const u = ix / widthSegments;
          const phi = phiStart + u * phiLength;
          vertex.x = -ringRadius * Math.cos(phi);
          vertex.y = y;
          vertex.z = ringRadius * Math.sin(phi);
          vertices.push(vertex.x, vertex.y, vertex.z);
          normal.copy(vertex).normalize();
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(u + uOffset, 1 - v);
          verticesRow.push(index++);
        }
        grid.push(verticesRow);
      }
      for (let iy = 0; iy < heightSegments; iy++) {
        for (let ix = 0; ix < widthSegments; ix++) {
          const a = grid[iy][ix + 1];
          const b = grid[iy][ix];
          const c = grid[iy + 1][ix];
          const d = grid[iy + 1][ix + 1];
          if (iy !== 0 || thetaStart > 0) indices.push(a, b, d);
          if (iy !== heightSegments - 1 || thetaEnd < Math.PI) indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new SphereGeometry(data.radius, data.widthSegments, data.heightSegments, data.phiStart, data.phiLength, data.thetaStart, data.thetaLength);
    }
  }

  class CylinderGeometry extends BufferGeometry {
    constructor(radiusTop = 1, radiusBottom = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
      super();
      this.type = "CylinderGeometry";
      this.parameters = { radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };
      const scope = this;
      radialSegments = Math.floor(radialSegments);
      heightSegments = Math.floor(heightSegments);
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      let index = 0;
      const indexArray = [];
      const halfHeight = height / 2;
      let groupStart = 0;
      generateTorso();
      if (openEnded === false) {
        if (radiusTop > 0) generateCap(true);
        if (radiusBottom > 0) generateCap(false);
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      function generateTorso() {
        const normal = new Vector3();
        const vertex = new Vector3();
        let groupCount = 0;
        const slope = (radiusBottom - radiusTop) / height;
        for (let y = 0; y <= heightSegments; y++) {
          const indexRow = [];
          const v = y / heightSegments;
          const radius = v * (radiusBottom - radiusTop) + radiusTop;
          for (let x = 0; x <= radialSegments; x++) {
            const u = x / radialSegments;
            const theta = u * thetaLength + thetaStart;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            vertex.x = radius * sinTheta;
            vertex.y = -v * height + halfHeight;
            vertex.z = radius * cosTheta;
            vertices.push(vertex.x, vertex.y, vertex.z);
            normal.set(sinTheta, slope, cosTheta).normalize();
            normals.push(normal.x, normal.y, normal.z);
            uvs.push(u, 1 - v);
            indexRow.push(index++);
          }
          indexArray.push(indexRow);
        }
        for (let x = 0; x < radialSegments; x++) {
          for (let y = 0; y < heightSegments; y++) {
            const a = indexArray[y][x];
            const b = indexArray[y + 1][x];
            const c = indexArray[y + 1][x + 1];
            const d = indexArray[y][x + 1];
            if (radiusTop > 0 || y !== 0) {
              indices.push(a, b, d);
              groupCount += 3;
            }
            if (radiusBottom > 0 || y !== heightSegments - 1) {
              indices.push(b, c, d);
              groupCount += 3;
            }
          }
        }
        scope.addGroup(groupStart, groupCount, 0);
        groupStart += groupCount;
      }
      function generateCap(top) {
        const centerIndexStart = index;
        const uv = new Vector2();
        const vertex = new Vector3();
        let groupCount = 0;
        const radius = top === true ? radiusTop : radiusBottom;
        const sign = top === true ? 1 : -1;
        for (let x = 1; x <= radialSegments; x++) {
          vertices.push(0, halfHeight * sign, 0);
          normals.push(0, sign, 0);
          uvs.push(0.5, 0.5);
          index++;
        }
        const centerIndexEnd = index;
        for (let x = 0; x <= radialSegments; x++) {
          const u = x / radialSegments;
          const theta = u * thetaLength + thetaStart;
          const cosTheta = Math.cos(theta);
          const sinTheta = Math.sin(theta);
          vertex.x = radius * sinTheta;
          vertex.y = halfHeight * sign;
          vertex.z = radius * cosTheta;
          vertices.push(vertex.x, vertex.y, vertex.z);
          normals.push(0, sign, 0);
          uv.x = cosTheta * 0.5 + 0.5;
          uv.y = sinTheta * 0.5 * sign + 0.5;
          uvs.push(uv.x, uv.y);
          index++;
        }
        for (let x = 0; x < radialSegments; x++) {
          const c = centerIndexStart + x;
          const i = centerIndexEnd + x;
          if (top === true) indices.push(i, i + 1, c);
          else indices.push(i + 1, i, c);
          groupCount += 3;
        }
        scope.addGroup(groupStart, groupCount, top === true ? 1 : 2);
        groupStart += groupCount;
      }
    }
    static fromJSON(data) {
      return new CylinderGeometry(
        data.radiusTop,
        data.radiusBottom,
        data.height,
        data.radialSegments,
        data.heightSegments,
        data.openEnded,
        data.thetaStart,
        data.thetaLength
      );
    }
  }

  class ConeGeometry extends CylinderGeometry {
    constructor(radius = 1, height = 1, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) {
      super(0, radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength);
      this.type = "ConeGeometry";
      this.parameters = { radius, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength };
    }
    static fromJSON(data) {
      return new ConeGeometry(
        data.radius,
        data.height,
        data.radialSegments,
        data.heightSegments,
        data.openEnded,
        data.thetaStart,
        data.thetaLength
      );
    }
  }

  class CircleGeometry extends BufferGeometry {
    constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
      super();
      this.type = "CircleGeometry";
      this.parameters = { radius, segments, thetaStart, thetaLength };
      segments = Math.max(3, segments);
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      const vertex = new Vector3();
      const uv = new Vector2();
      vertices.push(0, 0, 0);
      normals.push(0, 0, 1);
      uvs.push(0.5, 0.5);
      for (let s = 0, i = 3; s <= segments; s++, i += 3) {
        const segment = thetaStart + (s / segments) * thetaLength;
        vertex.x = radius * Math.cos(segment);
        vertex.y = radius * Math.sin(segment);
        vertices.push(vertex.x, vertex.y, vertex.z);
        normals.push(0, 0, 1);
        uv.x = (vertices[i] / radius + 1) / 2;
        uv.y = (vertices[i + 1] / radius + 1) / 2;
        uvs.push(uv.x, uv.y);
      }
      for (let i = 1; i <= segments; i++) indices.push(i, i + 1, 0);
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new CircleGeometry(data.radius, data.segments, data.thetaStart, data.thetaLength);
    }
  }

  class RingGeometry extends BufferGeometry {
    constructor(innerRadius = 0.5, outerRadius = 1, thetaSegments = 32, phiSegments = 1, thetaStart = 0, thetaLength = Math.PI * 2) {
      super();
      this.type = "RingGeometry";
      this.parameters = { innerRadius, outerRadius, thetaSegments, phiSegments, thetaStart, thetaLength };
      thetaSegments = Math.max(3, thetaSegments);
      phiSegments = Math.max(1, phiSegments);
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      let radius = innerRadius;
      const radiusStep = (outerRadius - innerRadius) / phiSegments;
      const vertex = new Vector3();
      const uv = new Vector2();
      for (let j = 0; j <= phiSegments; j++) {
        for (let i = 0; i <= thetaSegments; i++) {
          const segment = thetaStart + (i / thetaSegments) * thetaLength;
          vertex.x = radius * Math.cos(segment);
          vertex.y = radius * Math.sin(segment);
          vertices.push(vertex.x, vertex.y, vertex.z);
          normals.push(0, 0, 1);
          uv.x = (vertex.x / outerRadius + 1) / 2;
          uv.y = (vertex.y / outerRadius + 1) / 2;
          uvs.push(uv.x, uv.y);
        }
        radius += radiusStep;
      }
      for (let j = 0; j < phiSegments; j++) {
        const thetaSegmentLevel = j * (thetaSegments + 1);
        for (let i = 0; i < thetaSegments; i++) {
          const segment = i + thetaSegmentLevel;
          const a = segment;
          const b = segment + thetaSegments + 1;
          const c = segment + thetaSegments + 2;
          const d = segment + 1;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new RingGeometry(data.innerRadius, data.outerRadius, data.thetaSegments, data.phiSegments, data.thetaStart, data.thetaLength);
    }
  }

  class TorusGeometry extends BufferGeometry {
    constructor(radius = 1, tube = 0.4, radialSegments = 12, tubularSegments = 48, arc = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI * 2) {
      super();
      this.type = "TorusGeometry";
      this.parameters = { radius, tube, radialSegments, tubularSegments, arc, thetaStart, thetaLength };
      radialSegments = Math.floor(radialSegments);
      tubularSegments = Math.floor(tubularSegments);
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      const center = new Vector3();
      const vertex = new Vector3();
      const normal = new Vector3();
      for (let j = 0; j <= radialSegments; j++) {
        const v = thetaStart + (j / radialSegments) * thetaLength;
        for (let i = 0; i <= tubularSegments; i++) {
          const u = (i / tubularSegments) * arc;
          vertex.x = (radius + tube * Math.cos(v)) * Math.cos(u);
          vertex.y = (radius + tube * Math.cos(v)) * Math.sin(u);
          vertex.z = tube * Math.sin(v);
          vertices.push(vertex.x, vertex.y, vertex.z);
          center.x = radius * Math.cos(u);
          center.y = radius * Math.sin(u);
          normal.subVectors(vertex, center).normalize();
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(i / tubularSegments);
          uvs.push(j / radialSegments);
        }
      }
      for (let j = 1; j <= radialSegments; j++) {
        for (let i = 1; i <= tubularSegments; i++) {
          const a = (tubularSegments + 1) * j + i - 1;
          const b = (tubularSegments + 1) * (j - 1) + i - 1;
          const c = (tubularSegments + 1) * (j - 1) + i;
          const d = (tubularSegments + 1) * j + i;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new TorusGeometry(data.radius, data.tube, data.radialSegments, data.tubularSegments, data.arc, data.thetaStart, data.thetaLength);
    }
  }

  class TorusKnotGeometry extends BufferGeometry {
    constructor(radius = 1, tube = 0.4, tubularSegments = 64, radialSegments = 8, p = 2, q = 3) {
      super();
      this.type = "TorusKnotGeometry";
      this.parameters = { radius, tube, tubularSegments, radialSegments, p, q };
      tubularSegments = Math.floor(tubularSegments);
      radialSegments = Math.floor(radialSegments);
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      const vertex = new Vector3();
      const normal = new Vector3();
      const P1 = new Vector3();
      const P2 = new Vector3();
      const B = new Vector3();
      const T = new Vector3();
      const N = new Vector3();
      for (let i = 0; i <= tubularSegments; ++i) {
        const u = (i / tubularSegments) * p * Math.PI * 2;
        calculatePositionOnCurve(u, p, q, radius, P1);
        calculatePositionOnCurve(u + 0.01, p, q, radius, P2);
        T.subVectors(P2, P1);
        N.addVectors(P2, P1);
        B.crossVectors(T, N);
        N.crossVectors(B, T);
        B.normalize();
        N.normalize();
        for (let j = 0; j <= radialSegments; ++j) {
          const v = (j / radialSegments) * Math.PI * 2;
          const cx = -tube * Math.cos(v);
          const cy = tube * Math.sin(v);
          vertex.x = P1.x + (cx * N.x + cy * B.x);
          vertex.y = P1.y + (cx * N.y + cy * B.y);
          vertex.z = P1.z + (cx * N.z + cy * B.z);
          vertices.push(vertex.x, vertex.y, vertex.z);
          normal.subVectors(vertex, P1).normalize();
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(i / tubularSegments);
          uvs.push(j / radialSegments);
        }
      }
      for (let j = 1; j <= tubularSegments; j++) {
        for (let i = 1; i <= radialSegments; i++) {
          const a = (radialSegments + 1) * (j - 1) + (i - 1);
          const b = (radialSegments + 1) * j + (i - 1);
          const c = (radialSegments + 1) * j + i;
          const d = (radialSegments + 1) * (j - 1) + i;
          indices.push(a, b, d);
          indices.push(b, c, d);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      function calculatePositionOnCurve(u, p, q, radius, position) {
        const cu = Math.cos(u);
        const su = Math.sin(u);
        const quOverP = (q / p) * u;
        const cs = Math.cos(quOverP);
        position.x = radius * (2 + cs) * 0.5 * cu;
        position.y = radius * (2 + cs) * su * 0.5;
        position.z = radius * Math.sin(quOverP) * 0.5;
      }
    }
    static fromJSON(data) {
      return new TorusKnotGeometry(data.radius, data.tube, data.tubularSegments, data.radialSegments, data.p, data.q);
    }
  }

  class CapsuleGeometry extends BufferGeometry {
    constructor(radius = 1, height = 1, capSegments = 4, radialSegments = 8, heightSegments = 1) {
      super();
      this.type = "CapsuleGeometry";
      this.parameters = { radius, height, capSegments, radialSegments, heightSegments };
      height = Math.max(0, height);
      capSegments = Math.max(1, Math.floor(capSegments));
      radialSegments = Math.max(3, Math.floor(radialSegments));
      heightSegments = Math.max(1, Math.floor(heightSegments));
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      const halfHeight = height / 2;
      const capArcLength = (Math.PI / 2) * radius;
      const cylinderPartLength = height;
      const totalArcLength = 2 * capArcLength + cylinderPartLength;
      const numVerticalSegments = capSegments * 2 + heightSegments;
      const verticesPerRow = radialSegments + 1;
      const normal = new Vector3();
      const vertex = new Vector3();
      for (let iy = 0; iy <= numVerticalSegments; iy++) {
        let currentArcLength = 0;
        let profileY = 0;
        let profileRadius = 0;
        let normalYComponent = 0;
        if (iy <= capSegments) {
          const segmentProgress = iy / capSegments;
          const angle = (segmentProgress * Math.PI) / 2;
          profileY = -halfHeight - radius * Math.cos(angle);
          profileRadius = radius * Math.sin(angle);
          normalYComponent = -radius * Math.cos(angle);
          currentArcLength = segmentProgress * capArcLength;
        } else if (iy <= capSegments + heightSegments) {
          const segmentProgress = (iy - capSegments) / heightSegments;
          profileY = -halfHeight + segmentProgress * height;
          profileRadius = radius;
          normalYComponent = 0;
          currentArcLength = capArcLength + segmentProgress * cylinderPartLength;
        } else {
          const segmentProgress = (iy - capSegments - heightSegments) / capSegments;
          const angle = (segmentProgress * Math.PI) / 2;
          profileY = halfHeight + radius * Math.sin(angle);
          profileRadius = radius * Math.cos(angle);
          normalYComponent = radius * Math.sin(angle);
          currentArcLength = capArcLength + cylinderPartLength + segmentProgress * capArcLength;
        }
        const v = Math.max(0, Math.min(1, currentArcLength / totalArcLength));
        let uOffset = 0;
        if (iy === 0) uOffset = 0.5 / radialSegments;
        else if (iy === numVerticalSegments) uOffset = -0.5 / radialSegments;
        for (let ix = 0; ix <= radialSegments; ix++) {
          const u = ix / radialSegments;
          const theta = u * Math.PI * 2;
          const sinTheta = Math.sin(theta);
          const cosTheta = Math.cos(theta);
          vertex.x = -profileRadius * cosTheta;
          vertex.y = profileY;
          vertex.z = profileRadius * sinTheta;
          vertices.push(vertex.x, vertex.y, vertex.z);
          normal.set(-profileRadius * cosTheta, normalYComponent, profileRadius * sinTheta);
          normal.normalize();
          normals.push(normal.x, normal.y, normal.z);
          uvs.push(u + uOffset, v);
        }
        if (iy > 0) {
          const prevIndexRow = (iy - 1) * verticesPerRow;
          for (let ix = 0; ix < radialSegments; ix++) {
            const i1 = prevIndexRow + ix;
            const i2 = prevIndexRow + ix + 1;
            const i3 = iy * verticesPerRow + ix;
            const i4 = iy * verticesPerRow + ix + 1;
            indices.push(i1, i2, i3);
            indices.push(i2, i4, i3);
          }
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    }
    static fromJSON(data) {
      return new CapsuleGeometry(data.radius, data.height, data.capSegments, data.radialSegments, data.heightSegments);
    }
  }

  class PolyhedronGeometry extends BufferGeometry {
    constructor(vertices = [], indices = [], radius = 1, detail = 0) {
      super();
      this.type = "PolyhedronGeometry";
      this.parameters = { vertices, indices, radius, detail };
      const vertexBuffer = [];
      const uvBuffer = [];
      subdivide(detail);
      applyRadius(radius);
      generateUVs();
      this.setAttribute("position", new Float32BufferAttribute(vertexBuffer, 3));
      const normalBuffer = vertexBuffer.slice();
      this.setAttribute("normal", new Float32BufferAttribute(normalBuffer, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvBuffer, 2));
      if (detail === 0) computeVertexNormals(this);
      else normalizeNormals(this);
      function subdivide(detailLevel) {
        const a = new Vector3();
        const b = new Vector3();
        const c = new Vector3();
        for (let i = 0; i < indices.length; i += 3) {
          getVertexByIndex(indices[i + 0], a);
          getVertexByIndex(indices[i + 1], b);
          getVertexByIndex(indices[i + 2], c);
          subdivideFace(a, b, c, detailLevel);
        }
      }
      function subdivideFace(a, b, c, detailLevel) {
        const cols = detailLevel + 1;
        const v = [];
        for (let i = 0; i <= cols; i++) {
          v[i] = [];
          const aj = a.clone().lerp(c, i / cols);
          const bj = b.clone().lerp(c, i / cols);
          const rows = cols - i;
          for (let j = 0; j <= rows; j++) {
            if (j === 0 && i === cols) v[i][j] = aj;
            else v[i][j] = aj.clone().lerp(bj, j / rows);
          }
        }
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < 2 * (cols - i) - 1; j++) {
            const k = Math.floor(j / 2);
            if (j % 2 === 0) {
              pushVertex(v[i][k + 1]);
              pushVertex(v[i + 1][k]);
              pushVertex(v[i][k]);
            } else {
              pushVertex(v[i][k + 1]);
              pushVertex(v[i + 1][k + 1]);
              pushVertex(v[i + 1][k]);
            }
          }
        }
      }
      function applyRadius(r) {
        const vertex = new Vector3();
        for (let i = 0; i < vertexBuffer.length; i += 3) {
          vertex.x = vertexBuffer[i + 0];
          vertex.y = vertexBuffer[i + 1];
          vertex.z = vertexBuffer[i + 2];
          vertex.normalize().multiplyScalar(r);
          vertexBuffer[i + 0] = vertex.x;
          vertexBuffer[i + 1] = vertex.y;
          vertexBuffer[i + 2] = vertex.z;
        }
      }
      function generateUVs() {
        const vertex = new Vector3();
        for (let i = 0; i < vertexBuffer.length; i += 3) {
          vertex.x = vertexBuffer[i + 0];
          vertex.y = vertexBuffer[i + 1];
          vertex.z = vertexBuffer[i + 2];
          const u = azimuth(vertex) / 2 / Math.PI + 0.5;
          const v = inclination(vertex) / Math.PI + 0.5;
          uvBuffer.push(u, 1 - v);
        }
        correctUVs();
        correctSeam();
      }
      function correctSeam() {
        for (let i = 0; i < uvBuffer.length; i += 6) {
          const x0 = uvBuffer[i + 0];
          const x1 = uvBuffer[i + 2];
          const x2 = uvBuffer[i + 4];
          const max = Math.max(x0, x1, x2);
          const min = Math.min(x0, x1, x2);
          if (max > 0.9 && min < 0.1) {
            if (x0 < 0.2) uvBuffer[i + 0] += 1;
            if (x1 < 0.2) uvBuffer[i + 2] += 1;
            if (x2 < 0.2) uvBuffer[i + 4] += 1;
          }
        }
      }
      function pushVertex(vertex) {
        vertexBuffer.push(vertex.x, vertex.y, vertex.z);
      }
      function getVertexByIndex(index, vertex) {
        const stride = index * 3;
        vertex.x = vertices[stride + 0];
        vertex.y = vertices[stride + 1];
        vertex.z = vertices[stride + 2];
      }
      function correctUVs() {
        const a = new Vector3();
        const b = new Vector3();
        const c = new Vector3();
        const centroid = new Vector3();
        const uvA = new Vector2();
        const uvB = new Vector2();
        const uvC = new Vector2();
        for (let i = 0, j = 0; i < vertexBuffer.length; i += 9, j += 6) {
          a.set(vertexBuffer[i + 0], vertexBuffer[i + 1], vertexBuffer[i + 2]);
          b.set(vertexBuffer[i + 3], vertexBuffer[i + 4], vertexBuffer[i + 5]);
          c.set(vertexBuffer[i + 6], vertexBuffer[i + 7], vertexBuffer[i + 8]);
          uvA.set(uvBuffer[j + 0], uvBuffer[j + 1]);
          uvB.set(uvBuffer[j + 2], uvBuffer[j + 3]);
          uvC.set(uvBuffer[j + 4], uvBuffer[j + 5]);
          centroid.copy(a).add(b).add(c).divideScalar(3);
          const azi = azimuth(centroid);
          correctUV(uvA, j + 0, a, azi);
          correctUV(uvB, j + 2, b, azi);
          correctUV(uvC, j + 4, c, azi);
        }
      }
      function correctUV(uv, stride, vector, azi) {
        if (azi < 0 && uv.x === 1) uvBuffer[stride] = uv.x - 1;
        if (vector.x === 0 && vector.z === 0) uvBuffer[stride] = azi / 2 / Math.PI + 0.5;
      }
      function azimuth(vector) {
        return Math.atan2(vector.z, -vector.x);
      }
      function inclination(vector) {
        return Math.atan2(-vector.y, Math.sqrt(vector.x * vector.x + vector.z * vector.z));
      }
    }
    static fromJSON(data) {
      return new PolyhedronGeometry(data.vertices, data.indices, data.radius, data.detail);
    }
  }

  class DodecahedronGeometry extends PolyhedronGeometry {
    constructor(radius = 1, detail = 0) {
      const t = (1 + Math.sqrt(5)) / 2;
      const r = 1 / t;
      const vertices = [
        -1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1, 0, -r, -t, 0, -r, t, 0, r, -t, 0, r, t, -r, -t, 0, -r, t, 0, r, -t, 0, r, t, 0, -t, 0, -r, t, 0, -r, -t, 0, r, t, 0, r,
      ];
      const indices = [
        3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7, 19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
      ];
      super(vertices, indices, radius, detail);
      this.type = "DodecahedronGeometry";
      this.parameters = { radius, detail };
    }
    static fromJSON(data) {
      return new DodecahedronGeometry(data.radius, data.detail);
    }
  }

  class IcosahedronGeometry extends PolyhedronGeometry {
    constructor(radius = 1, detail = 0) {
      const t = (1 + Math.sqrt(5)) / 2;
      const vertices = [-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0, 0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1];
      const indices = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8, 3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
      super(vertices, indices, radius, detail);
      this.type = "IcosahedronGeometry";
      this.parameters = { radius, detail };
    }
    static fromJSON(data) {
      return new IcosahedronGeometry(data.radius, data.detail);
    }
  }

  class OctahedronGeometry extends PolyhedronGeometry {
    constructor(radius = 1, detail = 0) {
      const vertices = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
      const indices = [0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2];
      super(vertices, indices, radius, detail);
      this.type = "OctahedronGeometry";
      this.parameters = { radius, detail };
    }
    static fromJSON(data) {
      return new OctahedronGeometry(data.radius, data.detail);
    }
  }

  class TetrahedronGeometry extends PolyhedronGeometry {
    constructor(radius = 1, detail = 0) {
      const vertices = [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1];
      const indices = [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1];
      super(vertices, indices, radius, detail);
      this.type = "TetrahedronGeometry";
      this.parameters = { radius, detail };
    }
    static fromJSON(data) {
      return new TetrahedronGeometry(data.radius, data.detail);
    }
  }

  class LatheGeometry extends BufferGeometry {
    constructor(points, segments = 12, phiStart = 0, phiLength = Math.PI * 2) {
      super();
      this.type = "LatheGeometry";
      if (points === undefined) {
        points = [new Vector2(0, -0.5), new Vector2(0.5, 0), new Vector2(0, 0.5)];
      }
      this.parameters = { points, segments, phiStart, phiLength };
      segments = Math.floor(segments);
      phiLength = clamp(phiLength, 0, Math.PI * 2);
      const indices = [];
      const vertices = [];
      const uvs = [];
      const initNormals = [];
      const normals = [];
      const inverseSegments = 1.0 / segments;
      const vertex = new Vector3();
      const uv = new Vector2();
      const normal = new Vector3();
      const curNormal = new Vector3();
      const prevNormal = new Vector3();
      let dx = 0;
      let dy = 0;
      for (let j = 0; j <= points.length - 1; j++) {
        switch (j) {
          case 0:
            dx = points[j + 1].x - points[j].x;
            dy = points[j + 1].y - points[j].y;
            normal.x = dy * 1.0;
            normal.y = -dx;
            normal.z = dy * 0.0;
            prevNormal.copy(normal);
            normal.normalize();
            initNormals.push(normal.x, normal.y, normal.z);
            break;
          case points.length - 1:
            initNormals.push(prevNormal.x, prevNormal.y, prevNormal.z);
            break;
          default:
            dx = points[j + 1].x - points[j].x;
            dy = points[j + 1].y - points[j].y;
            normal.x = dy * 1.0;
            normal.y = -dx;
            normal.z = dy * 0.0;
            curNormal.copy(normal);
            normal.x += prevNormal.x;
            normal.y += prevNormal.y;
            normal.z += prevNormal.z;
            normal.normalize();
            initNormals.push(normal.x, normal.y, normal.z);
            prevNormal.copy(curNormal);
        }
      }
      for (let i = 0; i <= segments; i++) {
        const phi = phiStart + i * inverseSegments * phiLength;
        const sin = Math.sin(phi);
        const cos = Math.cos(phi);
        for (let j = 0; j <= points.length - 1; j++) {
          vertex.x = points[j].x * sin;
          vertex.y = points[j].y;
          vertex.z = points[j].x * cos;
          vertices.push(vertex.x, vertex.y, vertex.z);
          uv.x = i / segments;
          uv.y = j / (points.length - 1);
          uvs.push(uv.x, uv.y);
          const x = initNormals[3 * j + 0] * sin;
          const y = initNormals[3 * j + 1];
          const z = initNormals[3 * j + 0] * cos;
          normals.push(x, y, z);
        }
      }
      for (let i = 0; i < segments; i++) {
        for (let j = 0; j < points.length - 1; j++) {
          const base = j + i * points.length;
          const a = base;
          const b = base + points.length;
          const c = base + points.length + 1;
          const d = base + 1;
          indices.push(a, b, d);
          indices.push(c, d, b);
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    }
    static fromJSON(data) {
      return new LatheGeometry(data.points, data.segments, data.phiStart, data.phiLength);
    }
  }

  class ShapeGeometry extends BufferGeometry {
    constructor(shapes, curveSegments = 12) {
      super();
      this.type = "ShapeGeometry";
      if (shapes === undefined) {
        const pts = [new Vector2(0, 0.5), new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5)];
        shapes = typeof TN.Shape === "function" ? new TN.Shape(pts) : pts;
      }
      this.parameters = { shapes, curveSegments };
      const indices = [];
      const vertices = [];
      const normals = [];
      const uvs = [];
      let groupStart = 0;
      let groupCount = 0;
      if (isPointList(shapes) || Array.isArray(shapes) === false) {
        addShape(shapes);
      } else {
        for (let i = 0; i < shapes.length; i++) {
          addShape(shapes[i]);
          this.addGroup(groupStart, groupCount, i);
          groupStart += groupCount;
          groupCount = 0;
        }
      }
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      function addShape(shape) {
        const indexOffset = vertices.length / 3;
        const points = extractShapePoints(shape, curveSegments);
        let shapeVertices = points.shape;
        const shapeHoles = points.holes || [];
        if (isClockWise(shapeVertices) === false) shapeVertices = shapeVertices.reverse();
        for (let i = 0, l = shapeHoles.length; i < l; i++) {
          if (isClockWise(shapeHoles[i]) === true) shapeHoles[i] = shapeHoles[i].reverse();
        }
        const faces = triangulateShape(shapeVertices, shapeHoles);
        for (let i = 0, l = shapeHoles.length; i < l; i++) {
          shapeVertices = shapeVertices.concat(shapeHoles[i]);
        }
        for (let i = 0, l = shapeVertices.length; i < l; i++) {
          const vertex = shapeVertices[i];
          vertices.push(vertex.x, vertex.y, 0);
          normals.push(0, 0, 1);
          uvs.push(vertex.x, vertex.y);
        }
        for (let i = 0, l = faces.length; i < l; i++) {
          const face = faces[i];
          indices.push(face[0] + indexOffset, face[1] + indexOffset, face[2] + indexOffset);
          groupCount += 3;
        }
      }
    }
    static fromJSON(data, shapes) {
      const geometryShapes = [];
      if (data.shapes && shapes) {
        for (let j = 0, jl = data.shapes.length; j < jl; j++) geometryShapes.push(shapes[data.shapes[j]]);
        return new ShapeGeometry(geometryShapes, data.curveSegments);
      }
      return new ShapeGeometry(data.shapes, data.curveSegments);
    }
  }

  const WorldUVGenerator = {
    generateTopUV: function (geometry, vertices, indexA, indexB, indexC) {
      const a_x = vertices[indexA * 3];
      const a_y = vertices[indexA * 3 + 1];
      const b_x = vertices[indexB * 3];
      const b_y = vertices[indexB * 3 + 1];
      const c_x = vertices[indexC * 3];
      const c_y = vertices[indexC * 3 + 1];
      return [new Vector2(a_x, a_y), new Vector2(b_x, b_y), new Vector2(c_x, c_y)];
    },
    generateSideWallUV: function (geometry, vertices, indexA, indexB, indexC, indexD) {
      const a_x = vertices[indexA * 3];
      const a_y = vertices[indexA * 3 + 1];
      const a_z = vertices[indexA * 3 + 2];
      const b_x = vertices[indexB * 3];
      const b_y = vertices[indexB * 3 + 1];
      const b_z = vertices[indexB * 3 + 2];
      const c_x = vertices[indexC * 3];
      const c_y = vertices[indexC * 3 + 1];
      const c_z = vertices[indexC * 3 + 2];
      const d_x = vertices[indexD * 3];
      const d_y = vertices[indexD * 3 + 1];
      const d_z = vertices[indexD * 3 + 2];
      if (Math.abs(a_y - b_y) < Math.abs(a_x - b_x)) {
        return [new Vector2(a_x, 1 - a_z), new Vector2(b_x, 1 - b_z), new Vector2(c_x, 1 - c_z), new Vector2(d_x, 1 - d_z)];
      }
      return [new Vector2(a_y, 1 - a_z), new Vector2(b_y, 1 - b_z), new Vector2(c_y, 1 - c_z), new Vector2(d_y, 1 - d_z)];
    },
  };

  class ExtrudeGeometry extends BufferGeometry {
    constructor(shapes, options = {}) {
      super();
      this.type = "ExtrudeGeometry";
      if (shapes === undefined) {
        const pts = [new Vector2(0.5, 0.5), new Vector2(-0.5, 0.5), new Vector2(-0.5, -0.5), new Vector2(0.5, -0.5)];
        shapes = typeof TN.Shape === "function" ? new TN.Shape(pts) : pts;
      }
      this.parameters = { shapes, options };
      const list = Array.isArray(shapes) && !isPointList(shapes) ? shapes : [shapes];
      const scope = this;
      const verticesArray = [];
      const uvArray = [];
      for (let i = 0, l = list.length; i < l; i++) addShape(list[i]);
      this.setAttribute("position", new Float32BufferAttribute(verticesArray, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvArray, 2));
      computeVertexNormals(this);
      function addShape(shape) {
        const placeholder = [];
        const curveSegments = options.curveSegments !== undefined ? options.curveSegments : 12;
        const steps = options.steps !== undefined ? options.steps : 1;
        const depth = options.depth !== undefined ? options.depth : 1;
        let bevelEnabled = options.bevelEnabled !== undefined ? options.bevelEnabled : true;
        let bevelThickness = options.bevelThickness !== undefined ? options.bevelThickness : 0.2;
        let bevelSize = options.bevelSize !== undefined ? options.bevelSize : bevelThickness - 0.1;
        let bevelOffset = options.bevelOffset !== undefined ? options.bevelOffset : 0;
        let bevelSegments = options.bevelSegments !== undefined ? options.bevelSegments : 3;
        const extrudePath = options.extrudePath;
        const uvgen = options.UVGenerator !== undefined ? options.UVGenerator : WorldUVGenerator;
        let extrudePts;
        let extrudeByPath = false;
        let splineTube;
        let binormal;
        let normal;
        let position2;
        if (extrudePath) {
          extrudePts = extrudePath.getSpacedPoints ? extrudePath.getSpacedPoints(steps) : [];
          extrudeByPath = true;
          bevelEnabled = false;
          const isClosed = extrudePath.closed || false;
          splineTube = computeFrenetFrames(extrudePath, steps, isClosed);
          binormal = new Vector3();
          normal = new Vector3();
          position2 = new Vector3();
        }
        if (!bevelEnabled) {
          bevelSegments = 0;
          bevelThickness = 0;
          bevelSize = 0;
          bevelOffset = 0;
        }
        const shapePoints = extractShapePoints(shape, curveSegments);
        let vertices = shapePoints.shape;
        const holes = shapePoints.holes || [];
        const reverse = !isClockWise(vertices);
        if (reverse) {
          vertices = vertices.reverse();
          for (let h = 0, hl = holes.length; h < hl; h++) {
            if (isClockWise(holes[h])) holes[h] = holes[h].reverse();
          }
        }
        const numHoles = holes.length;
        const contour = vertices;
        for (let h = 0; h < numHoles; h++) vertices = vertices.concat(holes[h]);
        function scalePt2(pt, vec, size) {
          return new Vector2(pt.x + vec.x * size, pt.y + vec.y * size);
        }
        function getBevelVec(inPt, inPrev, inNext) {
          let v_trans_x;
          let v_trans_y;
          let shrink_by;
          const v_prev_x = inPt.x - inPrev.x;
          const v_prev_y = inPt.y - inPrev.y;
          const v_next_x = inNext.x - inPt.x;
          const v_next_y = inNext.y - inPt.y;
          const v_prev_lensq = v_prev_x * v_prev_x + v_prev_y * v_prev_y;
          const collinear0 = v_prev_x * v_next_y - v_prev_y * v_next_x;
          if (Math.abs(collinear0) > Number.EPSILON) {
            const v_prev_len = Math.sqrt(v_prev_lensq);
            const v_next_len = Math.sqrt(v_next_x * v_next_x + v_next_y * v_next_y);
            const ptPrevShift_x = inPrev.x - v_prev_y / v_prev_len;
            const ptPrevShift_y = inPrev.y + v_prev_x / v_prev_len;
            const ptNextShift_x = inNext.x - v_next_y / v_next_len;
            const ptNextShift_y = inNext.y + v_next_x / v_next_len;
            const sf =
              ((ptNextShift_x - ptPrevShift_x) * v_next_y - (ptNextShift_y - ptPrevShift_y) * v_next_x) /
              (v_prev_x * v_next_y - v_prev_y * v_next_x);
            v_trans_x = ptPrevShift_x + v_prev_x * sf - inPt.x;
            v_trans_y = ptPrevShift_y + v_prev_y * sf - inPt.y;
            const v_trans_lensq = v_trans_x * v_trans_x + v_trans_y * v_trans_y;
            if (v_trans_lensq <= 2) return new Vector2(v_trans_x, v_trans_y);
            shrink_by = Math.sqrt(v_trans_lensq / 2);
          } else {
            let direction_eq = false;
            if (v_prev_x > Number.EPSILON) {
              if (v_next_x > Number.EPSILON) direction_eq = true;
            } else if (v_prev_x < -Number.EPSILON) {
              if (v_next_x < -Number.EPSILON) direction_eq = true;
            } else if (Math.sign(v_prev_y) === Math.sign(v_next_y)) direction_eq = true;
            if (direction_eq) {
              v_trans_x = -v_prev_y;
              v_trans_y = v_prev_x;
              shrink_by = Math.sqrt(v_prev_lensq);
            } else {
              v_trans_x = v_prev_x;
              v_trans_y = v_prev_y;
              shrink_by = Math.sqrt(v_prev_lensq / 2);
            }
          }
          return new Vector2(v_trans_x / shrink_by, v_trans_y / shrink_by);
        }
        const contourMovements = [];
        for (let i = 0, il = contour.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
          if (j === il) j = 0;
          if (k === il) k = 0;
          contourMovements[i] = getBevelVec(contour[i], contour[j], contour[k]);
        }
        const holesMovements = [];
        let oneHoleMovements;
        let verticesMovements = contourMovements.concat();
        for (let h = 0, hl = numHoles; h < hl; h++) {
          const ahole = holes[h];
          oneHoleMovements = [];
          for (let i = 0, il = ahole.length, j = il - 1, k = i + 1; i < il; i++, j++, k++) {
            if (j === il) j = 0;
            if (k === il) k = 0;
            oneHoleMovements[i] = getBevelVec(ahole[i], ahole[j], ahole[k]);
          }
          holesMovements.push(oneHoleMovements);
          verticesMovements = verticesMovements.concat(oneHoleMovements);
        }
        const vlen = vertices.length;
        let faces;
        if (bevelSegments === 0) {
          faces = triangulateShape(contour, holes);
        } else {
          const contractedContourVertices = [];
          const expandedHoleVertices = [];
          for (let b = 0; b < bevelSegments; b++) {
            const t = b / bevelSegments;
            const z = bevelThickness * Math.cos((t * Math.PI) / 2);
            const bs = bevelSize * Math.sin((t * Math.PI) / 2) + bevelOffset;
            for (let i = 0, il = contour.length; i < il; i++) {
              const vert = scalePt2(contour[i], contourMovements[i], bs);
              v(vert.x, vert.y, -z);
              if (t === 0) contractedContourVertices.push(vert);
            }
            for (let h = 0, hl = numHoles; h < hl; h++) {
              const ahole = holes[h];
              oneHoleMovements = holesMovements[h];
              const oneHoleVertices = [];
              for (let i = 0, il = ahole.length; i < il; i++) {
                const vert = scalePt2(ahole[i], oneHoleMovements[i], bs);
                v(vert.x, vert.y, -z);
                if (t === 0) oneHoleVertices.push(vert);
              }
              if (t === 0) expandedHoleVertices.push(oneHoleVertices);
            }
          }
          faces = triangulateShape(contractedContourVertices, expandedHoleVertices);
        }
        const flen = faces.length;
        const bs = bevelSize + bevelOffset;
        for (let i = 0; i < vlen; i++) {
          const vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
          if (!extrudeByPath) v(vert.x, vert.y, 0);
          else {
            normal.copy(splineTube.normals[0]).multiplyScalar(vert.x);
            binormal.copy(splineTube.binormals[0]).multiplyScalar(vert.y);
            position2.copy(extrudePts[0]).add(normal).add(binormal);
            v(position2.x, position2.y, position2.z);
          }
        }
        for (let s = 1; s <= steps; s++) {
          for (let i = 0; i < vlen; i++) {
            const vert = bevelEnabled ? scalePt2(vertices[i], verticesMovements[i], bs) : vertices[i];
            if (!extrudeByPath) v(vert.x, vert.y, (depth / steps) * s);
            else {
              normal.copy(splineTube.normals[s]).multiplyScalar(vert.x);
              binormal.copy(splineTube.binormals[s]).multiplyScalar(vert.y);
              position2.copy(extrudePts[s]).add(normal).add(binormal);
              v(position2.x, position2.y, position2.z);
            }
          }
        }
        for (let b = bevelSegments - 1; b >= 0; b--) {
          const t = b / bevelSegments;
          const z = bevelThickness * Math.cos((t * Math.PI) / 2);
          const bsize = bevelSize * Math.sin((t * Math.PI) / 2) + bevelOffset;
          for (let i = 0, il = contour.length; i < il; i++) {
            const vert = scalePt2(contour[i], contourMovements[i], bsize);
            v(vert.x, vert.y, depth + z);
          }
          for (let h = 0, hl = holes.length; h < hl; h++) {
            const ahole = holes[h];
            oneHoleMovements = holesMovements[h];
            for (let i = 0, il = ahole.length; i < il; i++) {
              const vert = scalePt2(ahole[i], oneHoleMovements[i], bsize);
              if (!extrudeByPath) v(vert.x, vert.y, depth + z);
              else v(vert.x, vert.y + extrudePts[steps - 1].y, extrudePts[steps - 1].x + z);
            }
          }
        }
        buildLidFaces();
        buildSideFaces();
        function buildLidFaces() {
          const start = verticesArray.length / 3;
          if (bevelEnabled) {
            let layer = 0;
            let offset = vlen * layer;
            for (let i = 0; i < flen; i++) {
              const face = faces[i];
              f3(face[2] + offset, face[1] + offset, face[0] + offset);
            }
            layer = steps + bevelSegments * 2;
            offset = vlen * layer;
            for (let i = 0; i < flen; i++) {
              const face = faces[i];
              f3(face[0] + offset, face[1] + offset, face[2] + offset);
            }
          } else {
            for (let i = 0; i < flen; i++) {
              const face = faces[i];
              f3(face[2], face[1], face[0]);
            }
            for (let i = 0; i < flen; i++) {
              const face = faces[i];
              f3(face[0] + vlen * steps, face[1] + vlen * steps, face[2] + vlen * steps);
            }
          }
          scope.addGroup(start, verticesArray.length / 3 - start, 0);
        }
        function buildSideFaces() {
          const start = verticesArray.length / 3;
          let layeroffset = 0;
          sidewalls(contour, layeroffset);
          layeroffset += contour.length;
          for (let h = 0, hl = holes.length; h < hl; h++) {
            const ahole = holes[h];
            sidewalls(ahole, layeroffset);
            layeroffset += ahole.length;
          }
          scope.addGroup(start, verticesArray.length / 3 - start, 1);
        }
        function sidewalls(contourPts, layeroffset) {
          let i = contourPts.length;
          while (--i >= 0) {
            const j = i;
            let k = i - 1;
            if (k < 0) k = contourPts.length - 1;
            for (let s = 0, sl = steps + bevelSegments * 2; s < sl; s++) {
              const slen1 = vlen * s;
              const slen2 = vlen * (s + 1);
              const a = layeroffset + j + slen1;
              const b = layeroffset + k + slen1;
              const c = layeroffset + k + slen2;
              const d = layeroffset + j + slen2;
              f4(a, b, c, d);
            }
          }
        }
        function v(x, y, z) {
          placeholder.push(x, y, z);
        }
        function f3(a, b, c) {
          addVertex(a);
          addVertex(b);
          addVertex(c);
          const nextIndex = verticesArray.length / 3;
          const uvs = uvgen.generateTopUV(scope, verticesArray, nextIndex - 3, nextIndex - 2, nextIndex - 1);
          addUV(uvs[0]);
          addUV(uvs[1]);
          addUV(uvs[2]);
        }
        function f4(a, b, c, d) {
          addVertex(a);
          addVertex(b);
          addVertex(d);
          addVertex(b);
          addVertex(c);
          addVertex(d);
          const nextIndex = verticesArray.length / 3;
          const uvs = uvgen.generateSideWallUV(scope, verticesArray, nextIndex - 6, nextIndex - 3, nextIndex - 2, nextIndex - 1);
          addUV(uvs[0]);
          addUV(uvs[1]);
          addUV(uvs[3]);
          addUV(uvs[1]);
          addUV(uvs[2]);
          addUV(uvs[3]);
        }
        function addVertex(index) {
          verticesArray.push(placeholder[index * 3 + 0], placeholder[index * 3 + 1], placeholder[index * 3 + 2]);
        }
        function addUV(vector2) {
          uvArray.push(vector2.x, vector2.y);
        }
      }
    }
    static fromJSON(data, shapes) {
      const geometryShapes = [];
      if (data.shapes && shapes) {
        for (let j = 0, jl = data.shapes.length; j < jl; j++) geometryShapes.push(shapes[data.shapes[j]]);
        return new ExtrudeGeometry(geometryShapes, data.options || {});
      }
      return new ExtrudeGeometry(data.shapes, data.options || {});
    }
  }

  class TubeGeometry extends BufferGeometry {
    constructor(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
      super();
      this.type = "TubeGeometry";
      if (path == null) path = defaultTubePath();
      this.parameters = { path, tubularSegments, radius, radialSegments, closed };
      const frames = computeFrenetFrames(path, tubularSegments, closed);
      this.tangents = frames.tangents;
      this.normals = frames.normals;
      this.binormals = frames.binormals;
      const vertex = new Vector3();
      const normal = new Vector3();
      const uv = new Vector2();
      const P = new Vector3();
      const vertices = [];
      const normals = [];
      const uvs = [];
      const indices = [];
      generateBufferData();
      this.setIndex(indices);
      this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      this.setAttribute("normal", new Float32BufferAttribute(normals, 3));
      this.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
      function generateBufferData() {
        for (let i = 0; i < tubularSegments; i++) generateSegment(i);
        generateSegment(closed === false ? tubularSegments : 0);
        generateUVs();
        generateIndices();
      }
      function generateSegment(i) {
        pathPoint(path, i / tubularSegments, P);
        const N = frames.normals[i];
        const B = frames.binormals[i];
        for (let j = 0; j <= radialSegments; j++) {
          const v = (j / radialSegments) * Math.PI * 2;
          const sin = Math.sin(v);
          const cos = -Math.cos(v);
          normal.x = cos * N.x + sin * B.x;
          normal.y = cos * N.y + sin * B.y;
          normal.z = cos * N.z + sin * B.z;
          normal.normalize();
          normals.push(normal.x, normal.y, normal.z);
          vertex.x = P.x + radius * normal.x;
          vertex.y = P.y + radius * normal.y;
          vertex.z = P.z + radius * normal.z;
          vertices.push(vertex.x, vertex.y, vertex.z);
        }
      }
      function generateIndices() {
        for (let j = 1; j <= tubularSegments; j++) {
          for (let i = 1; i <= radialSegments; i++) {
            const a = (radialSegments + 1) * (j - 1) + (i - 1);
            const b = (radialSegments + 1) * j + (i - 1);
            const c = (radialSegments + 1) * j + i;
            const d = (radialSegments + 1) * (j - 1) + i;
            indices.push(a, b, d);
            indices.push(b, c, d);
          }
        }
      }
      function generateUVs() {
        for (let i = 0; i <= tubularSegments; i++) {
          for (let j = 0; j <= radialSegments; j++) {
            uv.x = i / tubularSegments;
            uv.y = j / radialSegments;
            uvs.push(uv.x, uv.y);
          }
        }
      }
    }
    static fromJSON(data) {
      let path;
      if (data.path && data.path.type && typeof TN[data.path.type] === "function") {
        path = new TN[data.path.type]().fromJSON(data.path);
      }
      return new TubeGeometry(path, data.tubularSegments, data.radius, data.radialSegments, data.closed);
    }
  }

  class EdgesGeometry extends BufferGeometry {
    constructor(geometry = null, thresholdAngle = 1) {
      super();
      this.type = "EdgesGeometry";
      this.parameters = { geometry, thresholdAngle };
      if (geometry !== null) {
        const precisionPoints = 4;
        const precision = Math.pow(10, precisionPoints);
        const thresholdDot = Math.cos((TN.DEG2RAD || Math.PI / 180) * thresholdAngle);
        const indexAttr = geometry.getIndex ? geometry.getIndex() : geometry.index;
        const positionAttr = geometry.getAttribute ? geometry.getAttribute("position") : geometry.attributes.position;
        const indexCount = indexAttr ? indexAttr.count : positionAttr.count;
        const indexArr = [0, 0, 0];
        const vertKeys = ["a", "b", "c"];
        const hashes = new Array(3);
        const edgeData = {};
        const vertices = [];
        const a = new Vector3();
        const b = new Vector3();
        const c = new Vector3();
        const _normal = new Vector3();
        const _v0 = new Vector3();
        const _v1 = new Vector3();
        const tri = { a, b, c };
        function fromAttr(v, attr, i) {
          if (typeof v.fromBufferAttribute === "function") return v.fromBufferAttribute(attr, i);
          return v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
        }
        for (let i = 0; i < indexCount; i += 3) {
          if (indexAttr) {
            indexArr[0] = indexAttr.getX(i);
            indexArr[1] = indexAttr.getX(i + 1);
            indexArr[2] = indexAttr.getX(i + 2);
          } else {
            indexArr[0] = i;
            indexArr[1] = i + 1;
            indexArr[2] = i + 2;
          }
          fromAttr(a, positionAttr, indexArr[0]);
          fromAttr(b, positionAttr, indexArr[1]);
          fromAttr(c, positionAttr, indexArr[2]);
          _v0.subVectors(c, b);
          _v1.subVectors(a, b);
          _normal.crossVectors(_v0, _v1).normalize();
          hashes[0] = `${Math.round(a.x * precision)},${Math.round(a.y * precision)},${Math.round(a.z * precision)}`;
          hashes[1] = `${Math.round(b.x * precision)},${Math.round(b.y * precision)},${Math.round(b.z * precision)}`;
          hashes[2] = `${Math.round(c.x * precision)},${Math.round(c.y * precision)},${Math.round(c.z * precision)}`;
          if (hashes[0] === hashes[1] || hashes[1] === hashes[2] || hashes[2] === hashes[0]) continue;
          for (let j = 0; j < 3; j++) {
            const jNext = (j + 1) % 3;
            const vecHash0 = hashes[j];
            const vecHash1 = hashes[jNext];
            const v0 = tri[vertKeys[j]];
            const v1 = tri[vertKeys[jNext]];
            const hash = `${vecHash0}_${vecHash1}`;
            const reverseHash = `${vecHash1}_${vecHash0}`;
            if (reverseHash in edgeData && edgeData[reverseHash]) {
              if (_normal.dot(edgeData[reverseHash].normal) <= thresholdDot) {
                vertices.push(v0.x, v0.y, v0.z);
                vertices.push(v1.x, v1.y, v1.z);
              }
              edgeData[reverseHash] = null;
            } else if (!(hash in edgeData)) {
              edgeData[hash] = {
                index0: indexArr[j],
                index1: indexArr[jNext],
                normal: _normal.clone(),
              };
            }
          }
        }
        for (const key in edgeData) {
          if (edgeData[key]) {
            const { index0, index1 } = edgeData[key];
            fromAttr(_v0, positionAttr, index0);
            fromAttr(_v1, positionAttr, index1);
            vertices.push(_v0.x, _v0.y, _v0.z);
            vertices.push(_v1.x, _v1.y, _v1.z);
          }
        }
        this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      }
    }
  }

  function isUniqueEdge(start, end, edges) {
    const hash1 = `${start.x},${start.y},${start.z}-${end.x},${end.y},${end.z}`;
    const hash2 = `${end.x},${end.y},${end.z}-${start.x},${start.y},${start.z}`;
    if (edges.has(hash1) === true || edges.has(hash2) === true) return false;
    edges.add(hash1);
    edges.add(hash2);
    return true;
  }

  class WireframeGeometry extends BufferGeometry {
    constructor(geometry = null) {
      super();
      this.type = "WireframeGeometry";
      this.parameters = { geometry };
      if (geometry !== null) {
        const vertices = [];
        const edges = new Set();
        const start = new Vector3();
        const end = new Vector3();
        function fromAttr(v, attr, i) {
          if (typeof v.fromBufferAttribute === "function") return v.fromBufferAttribute(attr, i);
          return v.set(attr.getX(i), attr.getY(i), attr.getZ(i));
        }
        if (geometry.index != null) {
          const position = geometry.attributes.position;
          const indices = geometry.index;
          let groups = geometry.groups;
          if (!groups || groups.length === 0) {
            groups = [{ start: 0, count: indices.count, materialIndex: 0 }];
          }
          for (let o = 0, ol = groups.length; o < ol; ++o) {
            const group = groups[o];
            const groupStart = group.start;
            const groupCount = group.count;
            for (let i = groupStart, l = groupStart + groupCount; i < l; i += 3) {
              for (let j = 0; j < 3; j++) {
                const index1 = indices.getX(i + j);
                const index2 = indices.getX(i + ((j + 1) % 3));
                fromAttr(start, position, index1);
                fromAttr(end, position, index2);
                if (isUniqueEdge(start, end, edges) === true) {
                  vertices.push(start.x, start.y, start.z);
                  vertices.push(end.x, end.y, end.z);
                }
              }
            }
          }
        } else {
          const position = geometry.attributes.position;
          for (let i = 0, l = position.count / 3; i < l; i++) {
            for (let j = 0; j < 3; j++) {
              const index1 = 3 * i + j;
              const index2 = 3 * i + ((j + 1) % 3);
              fromAttr(start, position, index1);
              fromAttr(end, position, index2);
              if (isUniqueEdge(start, end, edges) === true) {
                vertices.push(start.x, start.y, start.z);
                vertices.push(end.x, end.y, end.z);
              }
            }
          }
        }
        this.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      }
    }
  }

  const geometryCtors = [
    BoxGeometry,
    PlaneGeometry,
    SphereGeometry,
    CylinderGeometry,
    ConeGeometry,
    CircleGeometry,
    RingGeometry,
    TorusGeometry,
    TorusKnotGeometry,
    CapsuleGeometry,
    DodecahedronGeometry,
    IcosahedronGeometry,
    OctahedronGeometry,
    TetrahedronGeometry,
    PolyhedronGeometry,
    LatheGeometry,
    ExtrudeGeometry,
    ShapeGeometry,
    TubeGeometry,
    EdgesGeometry,
    WireframeGeometry,
  ];
  for (let i = 0; i < geometryCtors.length; i++) geometryCtors[i].prototype.copy = geometryCopy;

  TN.BoxGeometry = BoxGeometry;
  TN.PlaneGeometry = PlaneGeometry;
  TN.SphereGeometry = SphereGeometry;
  TN.CylinderGeometry = CylinderGeometry;
  TN.ConeGeometry = ConeGeometry;
  TN.CircleGeometry = CircleGeometry;
  TN.RingGeometry = RingGeometry;
  TN.TorusGeometry = TorusGeometry;
  TN.TorusKnotGeometry = TorusKnotGeometry;
  TN.CapsuleGeometry = CapsuleGeometry;
  TN.DodecahedronGeometry = DodecahedronGeometry;
  TN.IcosahedronGeometry = IcosahedronGeometry;
  TN.OctahedronGeometry = OctahedronGeometry;
  TN.TetrahedronGeometry = TetrahedronGeometry;
  TN.PolyhedronGeometry = PolyhedronGeometry;
  TN.LatheGeometry = LatheGeometry;
  TN.ExtrudeGeometry = ExtrudeGeometry;
  TN.ShapeGeometry = ShapeGeometry;
  TN.TubeGeometry = TubeGeometry;
  TN.EdgesGeometry = EdgesGeometry;
  TN.WireframeGeometry = WireframeGeometry;
})(globalThis.__TN = globalThis.__TN || {});
