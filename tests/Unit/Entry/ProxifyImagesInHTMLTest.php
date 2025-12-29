<?php

declare(strict_types=1);

namespace Tests\Unit\Entry;

use App\Actions\Entry\ProxifyImagesInHTML;
use Mockery;
use Onliner\ImgProxy\UrlBuilder;
use Tests\TestCase;

class ProxifyImagesInHTMLTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Mock the ImgProxy URL builder
        $mockBuilder = Mockery::mock(UrlBuilder::class);
        $mockBuilder->shouldReceive('with')->andReturnSelf();
        $mockBuilder->shouldReceive('url')->andReturnUsing(function ($url, $format) {
            return '/proxied/'.$format.'/'.base64_encode($url);
        });

        $this->app->instance(UrlBuilder::class, $mockBuilder);

        config(['services.imgproxy.url' => 'https://imgproxy.example.com']);
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    public function test_proxifies_img_src_attribute(): void
    {
        $html = '<img src="https://example.com/image.jpg" alt="Test">';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('https://imgproxy.example.com/proxied/webp/', $result);
        $this->assertStringNotContainsString('https://example.com/image.jpg', $result);
    }

    public function test_proxifies_img_srcset_attribute(): void
    {
        $html = '<img src="https://example.com/image.jpg" srcset="https://example.com/image-2x.jpg 2x, https://example.com/image-3x.jpg 3x">';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('https://imgproxy.example.com/proxied/webp/', $result);
        $this->assertStringContainsString('2x', $result);
        $this->assertStringContainsString('3x', $result);
    }

    public function test_proxifies_picture_source_srcset(): void
    {
        $html = '<picture><source srcset="https://example.com/image.webp"><img src="https://example.com/image.jpg"></picture>';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('https://imgproxy.example.com/proxied/webp/', $result);
    }

    public function test_handles_empty_content(): void
    {
        $action = new ProxifyImagesInHTML;
        $result = $action->handle('');

        $this->assertSame('', $result);
    }

    public function test_preserves_non_image_html(): void
    {
        $html = '<p>Hello world</p><a href="https://example.com">Link</a>';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('<p>Hello world</p>', $result);
        $this->assertStringContainsString('<a href="https://example.com">Link</a>', $result);
    }

    public function test_handles_multiple_images(): void
    {
        $html = '<img src="https://example.com/image1.jpg"><img src="https://example.com/image2.jpg">';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        // Both images should be proxified
        $this->assertSame(2, substr_count($result, 'https://imgproxy.example.com/proxied/webp/'));
    }

    public function test_handles_utf8_content(): void
    {
        $html = '<p>Привет мир</p><img src="https://example.com/image.jpg">';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('Привет мир', $result);
        $this->assertStringContainsString('https://imgproxy.example.com/proxied/webp/', $result);
    }

    public function test_handles_img_without_src(): void
    {
        $html = '<img alt="No source image">';

        $action = new ProxifyImagesInHTML;
        $result = $action->handle($html);

        $this->assertStringContainsString('<img', $result);
    }
}
