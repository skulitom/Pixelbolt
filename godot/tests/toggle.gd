# Test-only EditorPlugin: exercise installation and reimport menu lifecycle.
@tool
extends EditorPlugin

func _enter_tree() -> void:
	call_deferred("_check")

func _check() -> void:
	var editor := get_editor_interface()
	while editor.get_resource_filesystem().is_scanning():
		await get_tree().process_frame
	for enabled in [false, true, false, true]:
		editor.set_plugin_enabled("pixelbolt", enabled)
		for i in 3:
			await get_tree().process_frame
	print("PIXELBOLT " + JSON.stringify({"toggle": editor.is_plugin_enabled("pixelbolt")}))
	while editor.get_resource_filesystem().is_scanning():
		await get_tree().process_frame
	get_tree().quit()
