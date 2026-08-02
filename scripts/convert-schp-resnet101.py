#!/usr/bin/env python3
"""Convert the official SCHP ATR ResNet101 checkpoint to a fixed 512px ONNX model."""

import argparse
import sys
import types
from pathlib import Path

import onnx
import torch
from torch import nn
from torch.nn import functional as F


class CompatibleABN(nn.Module):
    """Inference-compatible replacement for SCHP's compiled InPlaceABNSync."""

    def __init__(
        self,
        num_features: int,
        eps: float = 1e-5,
        momentum: float = 0.1,
        affine: bool = True,
        activation: str = "leaky_relu",
        slope: float = 0.01,
    ) -> None:
        super().__init__()
        self.eps = eps
        self.momentum = momentum
        self.activation = activation
        self.slope = slope
        if affine:
            self.weight = nn.Parameter(torch.ones(num_features))
            self.bias = nn.Parameter(torch.zeros(num_features))
        else:
            self.register_parameter("weight", None)
            self.register_parameter("bias", None)
        self.register_buffer("running_mean", torch.zeros(num_features))
        self.register_buffer("running_var", torch.ones(num_features))

    def forward(self, value: torch.Tensor) -> torch.Tensor:
        value = F.batch_norm(
            value,
            self.running_mean,
            self.running_var,
            self.weight,
            self.bias,
            False,
            self.momentum,
            self.eps,
        )
        if self.activation == "leaky_relu":
            return F.leaky_relu(value, negative_slope=self.slope)
        if self.activation == "relu":
            return F.relu(value)
        if self.activation == "elu":
            return F.elu(value)
        return value


class SchpAtrOutput(nn.Module):
    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        output = self.model(image)[0][-1]
        return F.interpolate(output, size=(512, 512), mode="bilinear", align_corners=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True, help="Official SCHP repository checkout")
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    fake_modules = types.ModuleType("modules")
    fake_modules.InPlaceABNSync = CompatibleABN
    sys.modules["modules"] = fake_modules
    sys.path.insert(0, str(args.source))
    from networks.AugmentCE2P import resnet101

    model = resnet101(num_classes=18, pretrained=None)
    checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    state = {key.removeprefix("module."): value for key, value in checkpoint["state_dict"].items()}
    model.load_state_dict(state, strict=True)
    wrapper = SchpAtrOutput(model.eval()).eval()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        torch.onnx.export(
            wrapper,
            torch.zeros(1, 3, 512, 512),
            args.output,
            input_names=["image"],
            output_names=["logits"],
            opset_version=18,
            do_constant_folding=True,
        )
    model_proto = onnx.load(args.output, load_external_data=True)
    embedded_output = args.output.with_suffix('.embedded.onnx')
    onnx.save_model(model_proto, embedded_output, save_as_external_data=False)
    embedded_output.replace(args.output)
    external_data = args.output.with_suffix(args.output.suffix + '.data')
    if external_data.exists():
        external_data.unlink()


if __name__ == "__main__":
    main()
