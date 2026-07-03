# syntax=docker/dockerfile:1.7
FROM pytorch/pytorch:2.5.1-cuda12.1-cudnn9-runtime

ARG ORPHEUS_COMMIT=e64661fe6d02c414fc77c53578c9d64082614861
ARG ORPHEUS_MODEL_REVISION=4206a56e5a68cf6cf96900a8a78acd3370c02eb6
ARG SNAC_MODEL_REVISION=d73ad176a12188fcf4f360ba3bf2c2fbbe8f58ec

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/canopyai/Orpheus-TTS.git /opt/orpheus \
    && cd /opt/orpheus \
    && git checkout "$ORPHEUS_COMMIT" \
    && pip install --no-cache-dir ./orpheus_tts_pypi \
    && pip install --no-cache-dir vllm==0.7.3

RUN --mount=type=secret,id=hf_token,required=true \
    HF_TOKEN="$(cat /run/secrets/hf_token)" \
    python -c "import os; from huggingface_hub import snapshot_download; snapshot_download('canopylabs/orpheus-3b-0.1-ft', revision='${ORPHEUS_MODEL_REVISION}', token=os.environ['HF_TOKEN'], allow_patterns=['*.json', '*.safetensors', '*.model', '*.txt'])"

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('hubertsiuzdak/snac_24khz', revision='${SNAC_MODEL_REVISION}', allow_patterns=['*.json', '*.bin'])"

# Orpheus and SNAC request the symbolic `main` revision at runtime. Keep the
# downloads immutable while teaching Hugging Face's offline cache which pinned
# snapshot `main` refers to.
RUN mkdir -p \
      /root/.cache/huggingface/hub/models--canopylabs--orpheus-3b-0.1-ft/refs \
      /root/.cache/huggingface/hub/models--hubertsiuzdak--snac_24khz/refs \
    && printf '%s' "${ORPHEUS_MODEL_REVISION}" \
      > /root/.cache/huggingface/hub/models--canopylabs--orpheus-3b-0.1-ft/refs/main \
    && printf '%s' "${SNAC_MODEL_REVISION}" \
      > /root/.cache/huggingface/hub/models--hubertsiuzdak--snac_24khz/refs/main

# vLLM 0.7.3 predates Transformers 5.x. Orpheus currently leaves this
# dependency unbounded, which otherwise installs an incompatible tokenizer API.
RUN pip install --no-cache-dir \
      'transformers==4.48.2' \
      'tokenizers==0.21.0' \
    && pip uninstall -y humming-kernels

ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    SNAC_DEVICE=cpu

COPY worker.py /opt/doc2pod/worker.py
ENTRYPOINT ["python", "/opt/doc2pod/worker.py"]
