function DragScale(bar, ele, params) {
    this.bar = bar;
    this.ele = ele;
    this.params = params || {
        zoomVal: 1,
        left: 0,
        top: 0,
        currentX: 0,
        currentY: 0,
        moveVal: 400,
        wheelVal: 1200,
        flag: false
    }
}

DragScale.prototype.scale = function (mark) {
    var wheelVal = [event.wheelDelta, this.params.wheelVal, -this.params.wheelVal][mark];
    this.params.zoomVal += wheelVal / 1200;
    if (this.params.zoomVal < this.params.minZoomVal) this.params.zoomVal = this.params.minZoomVal;
    this.ele.css("transform", "scale(" + this.params.zoomVal + ")")
};

DragScale.prototype.getCss = function (key) {
    return this.ele.css(key);
};

DragScale.prototype.drag = function (callback) {
    this.ele.css("cursor", "move");
    var _that = this;
    if (this.getCss("left") !== "auto") {
        this.params.left = this.getCss("left")
    }
    if (this.getCss("top") !== "auto") {
        this.params.top = this.getCss("top")
    }
    this.bar.on("mousedown", function (event) {
        _that.params.flag = true;
        if (!event) {
            event = window.event;
            _that.bar.onselectstart = function () {
                return false;
            }
        }
        var e = event;
        _that.params.currentX = e.clientX;
        _that.params.currentY = e.clientY;
    });
    document.onmouseup = function () {
        _that.params.flag = false;
        if (_that.getCss("left") !== "auto") {
            _that.params.left = _that.getCss("left");
        }
        if (_that.getCss("top") !== "auto") {
            _that.params.top = _that.getCss("top");
        }
    };
    document.onmousemove = function (event) {
        var e = event ? event : window.event;
        if (_that.params.flag) {
            var nowX = e.clientX;
            var nowY = e.clientY;
            var disX = nowX - _that.params.currentX;
            var disY = nowY - _that.params.currentY;
            _that.ele.css("left", parseInt(_that.params.left) + disX + "px");
            _that.ele.css("top", parseInt(_that.params.top) + disY + "px");
            if (typeof callback === "function") {
                callback((parseInt(_that.params.left) || 0) + disX, (parseInt(_that.params.top) || 0) + disY);
            }
            if (event.preventDefault) {
                event.preventDefault();
            }
            return false;
        }
    }
};

DragScale.prototype.stopDrag = function () {
    this.ele.css("cursor", "default");
    this.bar.on("mousedown", function (event) {
    });
    document.onmouseup = function () {
    };
    document.onmousemove = function (event) {
    }
};

DragScale.prototype.moveUp = function () {
    this.ele.css("top", parseInt(this.params.top) - this.params.moveVal + "px");
    this.params.top = parseInt(this.params.top) - this.params.moveVal
};

DragScale.prototype.moveDown = function () {
    this.ele.css("top", parseInt(this.params.top) + this.params.moveVal + "px");
    this.params.top = parseInt(this.params.top) + this.params.moveVal
};

DragScale.prototype.moveLeft = function () {
    this.ele.css("left", parseInt(this.params.left) - this.params.moveVal + "px");
    this.params.left = parseInt(this.params.left) - this.params.moveVal
};

DragScale.prototype.moveRight = function () {
    this.ele.css("left", parseInt(this.params.left) + this.params.moveVal + "px");
    this.params.left = parseInt(this.params.left) + this.params.moveVal
};