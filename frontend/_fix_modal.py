#!/usr/bin/env python3
"""Merge template sync + payload preview into a single collapsible details."""

FILEPATH = 'src/components/visual-editor/workflow/GenerationComposerModal.tsx'

with open(FILEPATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find block 1 start: the line with "{currentStep === 2 && (" before "同步模板"
sync_label_idx = None
for i, line in enumerate(lines):
    if '\u540c\u6b65\u6a21\u677f' in line and 'label' in line:
        sync_label_idx = i
        break

assert sync_label_idx is not None, "Could not find template sync label"
print(f"Found sync label at line {sync_label_idx+1}")

block1_start = None
for i in range(sync_label_idx, -1, -1):
    if '{currentStep === 2 &&' in lines[i]:
        block1_start = i
        break

assert block1_start is not None

# Find block 2: payload preview - search for the line with "请求 Payload 预览"
payload_text_idx = None
for i, line in enumerate(lines):
    if '\u8bf7\u6c42 Payload \u9884\u89c8' in line:
        payload_text_idx = i
        break

assert payload_text_idx is not None, "Could not find Payload preview text"
print(f"Found payload text at line {payload_text_idx+1}")

block2_start = None
for i in range(payload_text_idx, -1, -1):
    if '{currentStep === 2 &&' in lines[i]:
        block2_start = i
        break

assert block2_start is not None

# Find the end of block 2 - count parens from block2_start
paren_depth = 0
block2_end = None
started = False
for i in range(block2_start, len(lines)):
    for c in lines[i]:
        if c == '(':
            paren_depth += 1
            started = True
        elif c == ')':
            paren_depth -= 1
            if started and paren_depth == 0:
                block2_end = i
                break
    if block2_end is not None:
        break

assert block2_end is not None
print(f"Block range: lines {block1_start+1}-{block2_end+1}")

# Build replacement
new_block = '''            {currentStep === 2 && (
              <details className="rounded-lg border border-gray-200">
                <summary className="px-3 py-2 text-xs text-gray-500 cursor-pointer hover:bg-gray-50 select-none">
                  \u6a21\u677f\u540c\u6b65 & \u8c03\u8bd5
                </summary>
                <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-600">\u540c\u6b65\u6a21\u677f ID</label>
                    <input
                      value={publishTemplateId}
                      onChange={(e) => setPublishTemplateId(e.target.value)}
                      placeholder="tmpl_xxx"
                      className="h-8 w-full rounded-lg border border-gray-200 px-2 text-xs"
                    />
                  </div>
                  <div>
                    <button
                      onClick={() => setShowPayloadPreview((prev) => !prev)}
                      className="text-[11px] text-gray-500 hover:text-gray-700"
                    >
                      {showPayloadPreview ? '\u9690\u85cf' : '\u67e5\u770b'} Payload
                    </button>
                    {showPayloadPreview && (
                      <pre className="mt-1 max-h-40 overflow-auto rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700">
                        {JSON.stringify(payloadPreview, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </details>
            )}
'''

new_lines = lines[:block1_start] + [new_block] + lines[block2_end+1:]

with open(FILEPATH, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

removed = block2_end - block1_start + 1
added = new_block.count('\n')
print(f"\u2705 Done! Removed {removed} lines, added {added} lines")
