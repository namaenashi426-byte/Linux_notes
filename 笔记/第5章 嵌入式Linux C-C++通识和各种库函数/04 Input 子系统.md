## 库文件（linux-input.h）

- **说明**：`<linux/input.h>`。

## input设备节点

- **说明**：/dev/input/。

## 已注册输入设备

- **说明**：/proc/bus/input/devices。

## input_event结构体

- **说明**：来自`<linux/input.h>`，input子系统转换而来的对应的“输入事件结构体”。成员如下：
- type：事件类型，有EV_KEY（按键事件）、`EV_REL`（相对移动事件）、`EV_ABS`（绝对坐标事件）、`EV_SYN`（同步事件）等。
- code：事件编号，如在“按键事件”中，对应按下的键码。
- value：事件值，如在“按键事件”中，对应0、1、2分别对应“松开”、“按下”、“长按”。
