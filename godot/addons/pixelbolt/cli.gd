# Finds the user's CLI on every import, drains both pipes and ends it at the import's time limit.
# 4.3 pipes block, so each has its own reader thread; newer pipes are nonblocking. On 4.3 a process the CLI left
# running that still holds a pipe delays the import until it exits.
@tool
extends RefCounted

const Settings = preload("settings.gd")
const OUTPUT_LIMIT := 4194304

static func absolute(file: String) -> String:
	if file.is_absolute_path():
		return ProjectSettings.globalize_path(file).simplify_path()
	return ProjectSettings.globalize_path("res://").path_join(file).simplify_path()

static func executable(file: String) -> String:
	if file.contains("/") or file.contains("\\") or file.is_absolute_path():
		var full := absolute(file)
		return full if FileAccess.file_exists(full) else ""
	var windows := OS.get_name() == "Windows"
	for folder in OS.get_environment("PATH").split(";" if windows else ":"):
		folder = folder.trim_prefix('"').trim_suffix('"')
		for suffix in (["", ".exe"] if windows else [""]):
			var full := folder.path_join(file + suffix)
			if FileAccess.file_exists(full):
				return full
	return ""

static func package_version(script: String) -> String:
	var file := script.get_base_dir().get_base_dir().path_join("package.json")
	if FileAccess.file_exists(file):
		var parser := JSON.new()
		if parser.parse(FileAccess.get_file_as_string(file)) == OK:
			var data = parser.data
			if data is Dictionary and data.get("name") == "pixelbolt" and data.get("version") is String:
				return data["version"]
	return "unknown"

static func resolve_cli() -> Dictionary:
	var configured := str(Settings.read("cli/path"))
	var script := ""
	var version := "unknown"
	var prefix := PackedStringArray()
	if not configured.is_empty():
		script = absolute(configured)
		if not FileAccess.file_exists(script):
			return {"error": "CLI not found at %s; fix pixelbolt/cli/path." % script}
	elif FileAccess.file_exists("res://node_modules/pixelbolt/bin/pixelbolt.js"):
		script = absolute("res://node_modules/pixelbolt/bin/pixelbolt.js")
	else:
		script = executable("pixelbolt.cmd" if OS.get_name() == "Windows" else "pixelbolt")
		if OS.get_name() == "Windows" and not script.is_empty():
			var global_script := script.get_base_dir().path_join("node_modules/pixelbolt/bin/pixelbolt.js")
			if FileAccess.file_exists(global_script):
				script = global_script
		if script.is_empty() and bool(Settings.read("cli/allow_npx")):
			version = str(Settings.read("cli/npx_version"))
			var pinned := RegEx.new()
			pinned.compile("^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$")
			if pinned.search(version) == null:
				return {"error": "Set pixelbolt/cli/npx_version to an exact version, such as " + Settings.version() + "."}
			script = executable("npx.cmd" if OS.get_name() == "Windows" else "npx")
			prefix = PackedStringArray(["-y", "pixelbolt@" + version])
	if script.is_empty():
		return {"error": "CLI not found; install Pixelbolt or set pixelbolt/cli/path (npx is disabled by default)."}
	if script.get_extension().to_lower() in ["js", "mjs"]:
		var node_setting := str(Settings.read("cli/node_path"))
		var node := executable(node_setting if not node_setting.is_empty() else "node")
		if node.is_empty():
			return {"error": "Node.js not found; install Node.js 20+ or fix pixelbolt/cli/node_path."}
		version = package_version(script)
		return {"exe": node, "args": PackedStringArray([script]), "version": version}
	return {"exe": script, "args": prefix, "version": version}

# A 4.3 pipe blocks until it has data, so an empty read is the end of the stream. Its error flag can't say so: on Unix
# it stays OK at the end and is set by a full read, and on Windows any short read sets it.
static func _read_pipe(pipe: FileAccess) -> PackedByteArray:
	var bytes := PackedByteArray()
	var chunk := pipe.get_buffer(65536)
	while not chunk.is_empty():
		if bytes.size() < OUTPUT_LIMIT:
			bytes.append_array(chunk.slice(0, OUTPUT_LIMIT - bytes.size()))
		chunk = pipe.get_buffer(65536)
	return bytes

static func kill_tree(pid: int) -> void:
	if OS.get_name() == "Windows":
		var killer := OS.create_process("taskkill.exe", PackedStringArray(["/PID", str(pid), "/T", "/F"]), false)
		var deadline := Time.get_ticks_msec() + 5000
		while killer > 0 and OS.is_process_running(killer) and Time.get_ticks_msec() < deadline:
			OS.delay_msec(10)
		if killer > 0 and OS.is_process_running(killer):
			OS.kill(killer)
		# Direct termination also closes the 4.3 reader pipes if system helpers failed.
		if OS.is_process_running(pid):
			OS.kill(pid)
		var until := Time.get_ticks_msec() + 5000
		while OS.is_process_running(pid) and Time.get_ticks_msec() < until:
			OS.delay_msec(10)
	else:
		# Every process the CLI started (an npx or shell wrapper's node, a render's own children) is found in ps's table
		# while the tree is still whole, and killed; then OS.kill ends and reaps the CLI itself. A process group would
		# not do: Godot 4.3 to 4.5 start the CLI in Godot's own group. Never ask about this pid again afterwards:
		# OS.kill has reaped it without telling Godot, which would log an error on the next query.
		for child in descendants(pid):
			OS.kill(child)
		OS.kill(pid)

# The pids below `pid` in the process tree, from `ps -A -o pid=,ppid=` (Linux and macOS alike).
static func descendants(pid: int) -> Array:
	var output := []
	OS.execute("ps", PackedStringArray(["-A", "-o", "pid=,ppid="]), output)
	var children := {}
	for line in (str(output[0]) if not output.is_empty() else "").split("\n", false):
		var fields := line.strip_edges().split(" ", false)
		if fields.size() == 2 and fields[0].is_valid_int() and fields[1].is_valid_int():
			var parent := int(fields[1])
			if not children.has(parent):
				children[parent] = []
			children[parent].append(int(fields[0]))
	var found := []
	var queue := [pid]
	while not queue.is_empty():
		for child in children.get(queue.pop_back(), []):
			if child != pid and not found.has(child):
				found.append(child)
				queue.append(child)
	return found

static func run(command: Dictionary, arguments: PackedStringArray, deadline: int) -> Dictionary:
	var program: String = command["exe"]
	var args: PackedStringArray = command["args"].duplicate()
	args.append_array(arguments)
	if OS.get_name() == "Windows" and program.get_extension().to_lower() in ["cmd", "bat"]:
		# cmd has its own parser. Reject expansions rather than silently executing a different path.
		var words := PackedStringArray([program])
		words.append_array(args)
		for word in words:
			if word.contains('"') or word.contains("%") or word.contains("^") or word.contains("\n") or word.contains("\r"):
				return {"error": "A batch CLI path contains cmd expansion characters; set cli/path to bin/pixelbolt.js."}
		program = executable("cmd.exe")
		# Godot quotes each argument for CreateProcess. CALL avoids cmd /c stripping
		# the first/last quotes around a command path containing spaces.
		args = PackedStringArray(["/d", "/v:off", "/c", "call"])
		args.append_array(words)
	var info := Engine.get_version_info()
	var modern: bool = int(info["major"]) > 4 or int(info["minor"]) >= 4
	var process: Dictionary
	if modern:
		process = OS.callv("execute_with_pipe", [program, args, false])
	else:
		process = OS.execute_with_pipe(program, args)
	if process.is_empty():
		return {"error": "Could not start CLI; check cli/path, cli/node_path and executable permissions."}
	var pid: int = process["pid"]
	var pipes := [process["stdio"], process["stderr"]]
	var buffers := [PackedByteArray(), PackedByteArray()]
	var threads := []
	if not modern:
		for pipe in pipes:
			var reader := Thread.new()
			reader.start(_read_pipe.bind(pipe))
			threads.append(reader)
	var timed_out := false
	while true:
		if modern:
			for i in 2:
				var chunk: PackedByteArray = pipes[i].get_buffer(65536)
				if buffers[i].size() < OUTPUT_LIMIT:
					buffers[i].append_array(chunk.slice(0, OUTPUT_LIMIT - buffers[i].size()))
		if not OS.is_process_running(pid):
			break
		if Time.get_ticks_msec() >= deadline:
			timed_out = true
			kill_tree(pid)
			break
		OS.delay_msec(10)
	var code := -1 if timed_out else OS.get_process_exit_code(pid)
	if modern:
		for i in 2:
			while true:
				var chunk: PackedByteArray = pipes[i].get_buffer(65536)
				if chunk.is_empty():
					break
				if buffers[i].size() < OUTPUT_LIMIT:
					buffers[i].append_array(chunk.slice(0, OUTPUT_LIMIT - buffers[i].size()))
	else:
		for i in 2:
			buffers[i] = threads[i].wait_to_finish()
	for pipe in pipes:
		pipe.close()
	if timed_out:
		return {"error": "CLI timed out; fix the recipe or increase pixelbolt/import/timeout_seconds."}
	var parser := JSON.new()
	var output: String = buffers[0].get_string_from_utf8()
	var errors: String = buffers[1].get_string_from_utf8()
	if code != 0:
		if parser.parse(errors) == OK and parser.data is Dictionary and parser.data.has("error"):
			# Pixelbolt's message usually starts with its path already; name the path only when it doesn't.
			var message := str(parser.data["error"])
			var where := str(parser.data.get("path", ""))
			if not where.is_empty() and not message.begins_with(where):
				message = where + ": " + message
			return {"error": message + "; fix the recipe and save it."}
		return {"error": "CLI exited %d: %s; check the CLI installation and recipe." % [code, errors.left(1000)]}
	if parser.parse(output) != OK or not parser.data is Dictionary or parser.data.get("ok") != true:
		return {"error": "Unreadable CLI reply; use a supported Pixelbolt CLI and reimport."}
	return parser.data
