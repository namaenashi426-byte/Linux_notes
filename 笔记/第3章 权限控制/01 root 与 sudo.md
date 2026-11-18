## root用户

- **说明**：拥有最大管理员权限。

	切换用户命令 \>\> `sudo su`，然后输入密码即可，所输密码不会显示，不指定用户名时即默认切换root用户；使用exit命令或快捷键Ctrl + d即可回退上一个用户。

> [!tip] PS
> （su 即“switch user”）

## sudo命令

- **说明**：用于给普通用户临时获取root权限以进行其他命令，但需要为对应用户配置sudo认证。

	认证方法 \>\> ①进入root用户，执行`visudo`命令，将使用默认编辑器（默认nano时把nano卸载即可）进入/etc/sudoers文件；②在文件最后一行添加该命令：“**username ALL=(ALL) NOPASSWD: ALL**”③运行`visudo -c`检查是否存在语法错误④此后已配置的用户若需再进行修改，直接执行`sudo visudo`命令即可。
