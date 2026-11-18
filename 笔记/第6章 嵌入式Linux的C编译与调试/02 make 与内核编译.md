- **说明**：基于 `Makefile` 编译。用于编译内核、驱动或整套系统；内核相关的 `make` 命令都要在**源码树**根目录下执行（依赖该目录的 `Makefile`）。

## 内核编译流程

1. **准备源码树**
	- 编译内核时的“源码树”，指 Linux 内核源码文件夹
2. **清理旧产物**：`make mrproper`
	- 删除所有 `.o`、`.config` 与备份文件，通常用于“重新开始一份全新配置”
3. **生成配置**：`make <board>_defconfig`
	- `<board>` 是厂商的板级配置名，可在 `arch/arm64/configs/` 下查看
	- 会在源码树根目录生成 `.config`，决定哪些驱动编进内核、哪些编成模块
4. **微调配置**：`make menuconfig`
	- 图形化界面，在已有 `.config` 基础上修改
5. **编译镜像**
	- `make zImage -j<n>`：内核镜像，产物在 `arch/arm/boot/zImage`
	- `make dtbs -j<n>`：设备树二进制，产物在 `arch/arm/boot/dts/*.dtb`
	- `make modules -j<n>`：驱动模块，在各驱动目录生成 `.ko`
	- `-j<n>`：并行任务数，一般取 CPU 核心数
6. **收拢产物**
	- `make modules_install INSTALL_MOD_PATH=~/tmp_dir`：把模块安装到临时目录，便于传输
	- 把 `zImage`、`.dtb` 复制到 `~/tmp_dir`
7. **安装到开发板**
	- `zImage`、`.dtb` → 板子 `/boot`
	- `lib/modules` → 板子 `/lib`
8. **生效**
	- 板子上执行 `sync` 落盘，再 `reboot` 重启加载新内核
	- 用 `uname -a` 查看内核编译时间，验证是否生效
9. **整体构建**：`make all`（可简写 `make`）
	- 按 `.config` 构建完整内核或系统
	- 编译驱动时依赖驱动目录的 `Makefile`，需自行指定其中的内核源码路径 `KERN_DIR`

## 驱动模块的编译与使用

- **产物**：`.ko` 驱动模块 + 用户态 ARM 可执行程序，一般放到板子 `/root`
- **加载**：`insmod name.ko` —— 注入内核、分配内存、创建设备节点，并调用模块的初始化函数
- **查看**：`lsmod` 列出已加载模块
- **卸载**：`rmmod name.ko` —— 释放模块占用的内存
- **顺序**：先加载模块，再调用用户态程序

## 两个例子

### Ex1：编译整套系统（Buildroot）

- 在 Buildroot 源码树下生成 `.config` 后执行 `make all`
- 会依次构建 u-boot、根文件系统（含内核模块）、内核、设备树，耗时很长
- 完成后把完整镜像烧写到板子上运行

### Ex2：构建适配开发板的 Qt 库

- 通过 Buildroot 指定板级配置包，再用对应的 Qt 构建命令，如 `make qt5base`
- Buildroot 会先拉取依赖包（可配置镜像源），最后完成 Qt 库构建
