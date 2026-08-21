class Controller {
  name() { return this; }
  onChange() { return this; }
  onFinishChange() { return this; }
  updateDisplay() { return this; }
}

export default class GUI {
  constructor() { this._controllers = []; }
  addFolder() { return this; }
  add() { const controller = new Controller(); this._controllers.push(controller); return controller; }
  addColor() { const controller = new Controller(); this._controllers.push(controller); return controller; }
  close() { return this; }
  controllersRecursive() { return this._controllers; }
  destroy() {}
}
