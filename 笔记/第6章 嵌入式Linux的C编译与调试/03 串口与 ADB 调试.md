## 串口连接开发板

- **说明**：用 USB 转串口接板子，通过终端软件看启动日志、登录系统。
- **步骤**
	1. 板子的 USB 串口接到主机
	2. MobaXterm 新建“串口会话”，波特率 `115200`、流控 `None`
	3. 给板子上电，等待启动完成
- **结果**：可以操作板子的 Linux 系统，并持续收到板子返回的状态与调试信息。

## ADB 方式调试（OTG 口）

- **前提**：板子系统要支持 ADB
	- 检查：串口下执行 `ps | grep adbd`，有 adbd 进程即支持
	- 不支持时：用官方烧录工具烧一套带 ADB 的系统

### 1. 设备接入 Linux 服务器（WSL）

- **WSL 不会自动识别 USB**，需在 Windows 的 cmd 里用 `usbipd` 转接：
	1. `usbipd list` 找到设备 id
	2. `usbipd bind -b <id>` 共享给 WSL（永久生效）
	3. `usbipd attach -b <id>` 添加给 WSL（**每次插拔、每次板子重启后都要重做**）
- **注意**：attach 前必须先释放设备占用，最快的办法是重插一次
- **确认**：在 Linux 服务器上 `lsusb`（需装包）可看到已连接的 USB 设备

### 2. 安装 adb 并确认设备

- Linux 服务器先装 adb 包；设备 attach 成功后用 `adb devices` 查看

### 3. 配置设备节点权限

- **原因**：新接入的设备节点普通用户没有读写权限，而 adb 调试需要频繁读写。
- **方式一：给 adb 提权** —— 让每条 adb 命令都自动带 root 权限

```bash
pwd adb                   # 得到 adb_path
sudo chmod a+x adb_path   # 赋予可执行权限
sudo chmod a+s adb_path   # s 提权
sudo adb kill-server      # 关掉权限变更前的 adb 进程
```

- **方式二：udev 规则** —— 板子每次通过 USB 接上，自动把设备节点权限改成 `0666`

```bash
sudo tee /etc/udev/rules.d/51-android.rules <<"EOF"
SUBSYSTEM=="usb",        # 只对 USB 子系统生效
ATTR{idVendor}=="1d6b",  # 匹配 VID 为 1d6b 的设备
MODE="0666",             # 设备节点权限 rw-rw-rw-
GROUP="plugdev"          # 属组设为 plugdev
EOF
```

- **规则说明**
	- 放在 `/etc/udev/rules.d/`，文件名 `51-android.rules`
	- `51-` 前缀用于排序，数字越小越早执行（Android 官方推荐用 51）
	- 该目录需要 root 写入，所以用 `sudo tee`
- **生效时机**：重启后生效

## ADB 常用命令

- `adb devices`：查看 Linux 服务器下的 ADB 设备
- `adb shell`：登录 ADB 设备
- `adb push 本地文件（目录） 远程路径`：本地 → 设备
- `adb pull 远程文件（目录） 本地路径`：设备 → 本地
