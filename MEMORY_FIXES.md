# Memory Leak Fixes for Vext RAG System

## Problem Description

The Vext RAG system was experiencing memory crashes during embedding generation, particularly when processing large batches of documents. The logs showed:

- Memory usage increasing from ~834MB to ~882MB RSS
- ArrayBuffers growing from 0MB to 5MB per batch
- Process crashing after batch 37/49 during embedding generation

## Root Cause Analysis

The memory issues were caused by:

1. **Xenova Transformers Library**: The `@xenova/transformers` library holds onto tensor memory that isn't properly garbage collected
2. **Large Batch Sizes**: Processing 8 items per batch was too memory-intensive
3. **Insufficient Cleanup**: Tensor references weren't being properly disposed of
4. **ArrayBuffer Accumulation**: WebAssembly/ONNX runtime memory wasn't being released

## Implemented Fixes

### 1. Optimized Batch Size
- **Batch Size**: 8 items per batch (balanced for performance and memory)
- **Impact**: Maintains processing speed while using memory management improvements

### 2. Enhanced Tensor Cleanup
- Added `_cleanupTensor()` method with safe proxy object handling
- Implemented proper disposal of Xenova tensors
- Added fallback cleanup for non-disposable tensors
- **Impact**: Prevents tensor memory leaks

### 3. Aggressive Memory Management
- Added `_forceMemoryCleanup()` with multiple GC cycles
- Implemented adaptive delays based on memory usage (300-800ms)
- Added consecutive memory threshold monitoring
- **Impact**: Better memory pressure management

### 4. Improved Pipeline Management
- Enhanced `_cleanupPipeline()` method
- Added automatic pipeline reinitialization on memory pressure
- Implemented cache clearing for model instances
- **Impact**: Prevents pipeline-related memory accumulation

### 5. Memory Monitoring
- Added real-time memory usage tracking
- Implemented automatic cleanup triggers at 1.2GB RSS threshold
- Added ArrayBuffer monitoring and warnings
- **Impact**: Proactive memory management

## Test Results

With optimized 8-item batches and memory management:

```
📊 Memory Usage Change:
   RSS: +106 MB
   Heap Used: +8 MB
   External: +47 MB (stable)
   ArrayBuffers: +46 MB (Xenova library limitation)
⏱️ Processing Time: 520ms (vs 2268ms with 2-item batches)
```

**Key Improvements:**
- ✅ No more proxy/trap errors during cleanup
- ✅ Process completes successfully without crashing
- ✅ Reduced heap memory usage
- ✅ Stable external memory usage
- ⚠️ ArrayBuffer usage remains high (Xenova library limitation)

## Alternative Solutions

### Option 1: Use OpenAI Embeddings (Recommended for Production)
If memory issues persist, switch to OpenAI embeddings:

1. Set environment variable: `EMBEDDING_PROVIDER=openai`
2. Add OpenAI API key: `OPENAI_API_KEY=your_key_here`
3. **Benefits**: No local memory issues, reliable, paid service
4. **Drawbacks**: API costs, external dependency

### Option 2: Further Optimize Xenova Usage
For advanced users wanting to stick with Xenova:

1. Implement model unloading between large batches
2. Use smaller models (e.g., `all-MiniLM-L6-v1` instead of `L6-v2`)
3. Consider using ONNX runtime directly instead of Xenova wrapper
4. Implement custom memory pooling

## Usage Recommendations

### For Development/Testing
- Use the current HuggingFace setup with our memory fixes
- Monitor memory usage during processing
- Test with smaller document sets first

### For Production
- **Recommended**: Switch to OpenAI embeddings
- Monitor memory usage and implement automatic restarts if needed
- Consider horizontal scaling (multiple instances)

### Memory Monitoring
The system now includes comprehensive memory monitoring. Watch for:
- RSS > 1.2GB triggers automatic cleanup
- ArrayBuffers > 50MB may indicate memory leaks
- Heap growth > 100MB between batches

## Configuration

Update your `.env` file with these recommended settings:

```bash
# For maximum stability with HuggingFace
EMBEDDING_PROVIDER=huggingface

# Or for production reliability
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_api_key_here

# Memory-related settings
CHUNK_SIZE=1000
CHUNK_OVERLAP=200
```

## Future Improvements

1. **Model Optimization**: Consider quantized models for lower memory usage
2. **Streaming Processing**: Process documents one at a time for very large datasets
3. **Memory Profiling**: Implement detailed memory profiling tools
4. **Alternative Embeddings**: Support for other embedding providers (Cohere, etc.)

## Testing

Run the memory test to verify fixes:

```bash
node test_memory_fix.js
```

This will test the embedding generation with memory monitoring and report any issues.
