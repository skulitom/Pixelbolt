# Settings shared by the plugin and importers. Reading never changes project.godot.
@tool
extends RefCounted

static func version() -> String:
	var config := ConfigFile.new()
	if config.load("res://addons/pixelbolt/plugin.cfg") == OK:
		return str(config.get_value("plugin", "version", "0.19.0"))
	return "0.19.0"

static func defaults() -> Dictionary:
	return {"cli/path": "", "cli/node_path": "", "cli/allow_npx": false,
		"cli/npx_version": version(), "import/timeout_seconds": 120}

static func read(key: String) -> Variant:
	return ProjectSettings.get_setting("pixelbolt/" + key, defaults()[key])

static func register() -> void:
	for key in defaults():
		var full: String = "pixelbolt/" + key
		var value = defaults()[key]
		if not ProjectSettings.has_setting(full):
			ProjectSettings.set_setting(full, value)
		ProjectSettings.set_initial_value(full, value)
		var info := {"name": full, "type": typeof(value)}
		if key.ends_with("path"):
			info["hint"] = PROPERTY_HINT_GLOBAL_FILE
		elif key == "import/timeout_seconds":
			info["hint"] = PROPERTY_HINT_RANGE
			info["hint_string"] = "1,3600,1,or_greater"
		ProjectSettings.add_property_info(info)
