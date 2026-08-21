class Controller {
  min() { return this; }
  max() { return this; }
  step() { return this; }
  name() { return this; }
  onChange() { return this; }
  onFinishChange() { return this; }
  updateDisplay() { return this; }
  listen() { return this; }
  disable() { return this; }
  enable() { return this; }
  show() { return this; }
  hide() { return this; }
  destroy() {}
}

export class GUI {
  constructor() {
    this._controllers = [];
    this.domElement = { style: {}, classList: { add() {}, remove() {} } };
    this.$children = { appendChild() {}, removeChild() {} };
  }
  addFolder() { return this; }
  add() { const controller = new Controller(); this._controllers.push(controller); return controller; }
  addColor() { const controller = new Controller(); this._controllers.push(controller); return controller; }
  close() { return this; }
  open() { return this; }
  show() { return this; }
  hide() { return this; }
  title() { return this; }
  controllersRecursive() { return this._controllers; }
  destroy() {}
}

export default GUI;
