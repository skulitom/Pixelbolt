# Exercise the plugin's menu callback with no edited recipe or settings save.
@tool
extends EditorPlugin

func _enter_tree() -> void:
	call_deferred("_check")

func _check() -> void:
	var filesystem := get_editor_interface().get_resource_filesystem()
	while filesystem.is_scanning():
		await get_tree().process_frame
	var plugin = load("res://addons/pixelbolt/plugin.gd").new()
	plugin._reimport_all()
	plugin.free()
	while filesystem.is_scanning():
		await get_tree().process_frame
	print("PIXELBOLT " + JSON.stringify({"reimport_all": true}))
	get_tree().quit()
