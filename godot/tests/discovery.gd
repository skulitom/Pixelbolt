# Tests discovery without invoking npx or any download.
extends SceneTree

const CLI = preload("res://addons/pixelbolt/cli.gd")
const Settings = preload("res://addons/pixelbolt/settings.gd")

func _initialize() -> void:
	var plan = JSON.parse_string(FileAccess.get_file_as_string("res://discovery.json"))
	OS.set_environment("PATH", plan["path"])
	var results := []
	for entry in plan["cases"]:
		for key in Settings.defaults():
			ProjectSettings.set_setting("pixelbolt/" + key, Settings.defaults()[key])
		for key in entry:
			ProjectSettings.set_setting("pixelbolt/" + key, entry[key])
		results.append(CLI.resolve_cli())
	print("PIXELBOLT " + JSON.stringify({"results": results}))
	quit()
