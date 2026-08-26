#!/usr/bin/env python3
"""Convert the upstream ReLIC++ CPC PyTorch checkpoint to a fixed-shape ONNX model."""

import argparse
import math
from pathlib import Path

import torch
import torch.nn as nn


class InvertedResidual(nn.Module):
    def __init__(self, inp, oup, stride, expand_ratio):
        super().__init__()
        self.stride = stride
        if stride not in (1, 2):
            raise ValueError("stride must be 1 or 2")
        self.use_res_connect = stride == 1 and inp == oup
        self.conv = nn.Sequential(
            nn.Conv2d(inp, inp * expand_ratio, 1, 1, 0, bias=False),
            nn.BatchNorm2d(inp * expand_ratio),
            nn.ReLU6(inplace=True),
            nn.Conv2d(inp * expand_ratio, inp * expand_ratio, 3, stride, 1, groups=inp * expand_ratio, bias=False),
            nn.BatchNorm2d(inp * expand_ratio),
            nn.ReLU6(inplace=True),
            nn.Conv2d(inp * expand_ratio, oup, 1, 1, 0, bias=False),
            nn.BatchNorm2d(oup),
        )

    def forward(self, x):
        return x + self.conv(x) if self.use_res_connect else self.conv(x)


def conv_bn(inp, oup, stride):
    return nn.Sequential(
        nn.Conv2d(inp, oup, 3, stride, 1, bias=False),
        nn.BatchNorm2d(oup),
        nn.ReLU(inplace=True),
    )


def conv_1x1_bn(inp, oup):
    return nn.Sequential(
        nn.Conv2d(inp, oup, 1, 1, 0, bias=False),
        nn.BatchNorm2d(oup),
        nn.ReLU(inplace=True),
    )


class MobileNetV2(nn.Module):
    def __init__(self, input_size=224, width_mult=1.0):
        super().__init__()
        settings = [
            [1, 16, 1, 1], [6, 24, 2, 2], [6, 32, 3, 2],
            [6, 64, 4, 2], [6, 96, 3, 1], [6, 160, 3, 2], [6, 320, 1, 1],
        ]
        if input_size % 32 != 0:
            raise ValueError("input size must be divisible by 32")
        input_channel = int(32 * width_mult)
        self.last_channel = int(1280 * width_mult) if width_mult > 1.0 else 1280
        features = [conv_bn(3, input_channel, 2)]
        for expand_ratio, channels, repeats, stride in settings:
            output_channel = int(channels * width_mult)
            for index in range(repeats):
                features.append(InvertedResidual(
                    input_channel,
                    output_channel,
                    stride if index == 0 else 1,
                    expand_ratio,
                ))
                input_channel = output_channel
        features.append(conv_1x1_bn(input_channel, self.last_channel))
        self.features = nn.Sequential(*features)
        self.avgpool = nn.AvgPool2d(input_size // 32)
        self.classifier = nn.Sequential(nn.Dropout(), nn.Linear(self.last_channel, 1000))

    def forward(self, x):
        x = self.avgpool(self.features(x))
        return self.classifier(x.reshape(-1, self.last_channel))


def self_attention_map(x):
    batch_size, channels, height, width = x.size()
    query = x.reshape(batch_size, channels, -1)
    key = query
    query = query.permute(0, 2, 1)
    similarity = torch.matmul(query, key)
    query_norm = torch.norm(query, dim=2, keepdim=True)
    key_norm = torch.norm(key, dim=1, keepdim=True)
    similarity = similarity / torch.matmul(query_norm, key_norm).clamp(min=1e-8)
    return similarity


class CAT(nn.Module):
    def __init__(self):
        super().__init__()
        mobile = MobileNetV2()
        self.base_model = nn.Sequential(*list(mobile.children())[:-1])
        self.sa_model = nn.Sequential(*list(MobileNetV2().children())[:-2])

    def forward(self, x):
        base = self.base_model(x).reshape(x.shape[0], -1)
        attention = self_attention_map(self.sa_model(x)).reshape(x.shape[0], -1)
        return base, attention


class Relic2Cpc(nn.Module):
    def __init__(self):
        super().__init__()
        self.base_model = CAT()
        self.fc = nn.Linear(8, 64)
        self.relu = nn.Tanh()
        self.fc1 = nn.Linear(64, 2)
        self.sm = nn.Sigmoid()
        self.head = nn.Sequential(
            nn.Linear(3681, 50),
            nn.ReLU(True),
            nn.Dropout(),
            nn.Linear(50, 1),
        )

    def forward(self, x):
        x1, x2 = self.base_model(x)
        x1_stats = torch.cat([
            torch.max(x1, dim=1)[0].unsqueeze(1),
            torch.min(x1, dim=1)[0].unsqueeze(1),
            torch.mean(x1, dim=1).unsqueeze(1),
            torch.std(x1, dim=1).unsqueeze(1),
        ], 1)
        x2_stats = torch.cat([
            torch.max(x2, dim=1)[0].unsqueeze(1),
            torch.min(x2, dim=1)[0].unsqueeze(1),
            torch.mean(x2, dim=1).unsqueeze(1),
            torch.std(x2, dim=1).unsqueeze(1),
        ], 1)
        gate = self.sm(self.fc1(self.relu(self.fc(torch.cat([x1_stats, x2_stats], 1)))))
        features = torch.cat([x1 * gate[:, 0:1], x2 * gate[:, 1:2]], 1)
        return self.head(features)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    model = Relic2Cpc().eval()
    state = torch.load(args.weights, map_location="cpu")
    model.load_state_dict(state, strict=True)
    sample = torch.zeros(1, 3, 224, 224, dtype=torch.float32)
    with torch.no_grad():
        reference = model(sample)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        sample,
        args.output,
        input_names=["input"],
        output_names=["composition_score"],
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    print(f"reference={reference.item():.8f}")
    print(f"output={args.output} bytes={args.output.stat().st_size}")


if __name__ == "__main__":
    main()
