<?php

declare(strict_types=1);

namespace Tests\Feature\OPML;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class ImportOPMLTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    public function test_xxe_network_attack_is_blocked(): void
    {
        $user = User::factory()->create();

        // Create a malicious OPML file with XXE payload
        // This attempts to load an external entity from a remote server
        $maliciousOpml = <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE opml [
  <!ENTITY xxe SYSTEM "http://malicious-server.example.com/xxe">
]>
<opml version="1.0">
    <head>
        <title>Malicious OPML</title>
    </head>
    <body>
        <outline text="Test Category">
            <outline text="&xxe;" title="&xxe;" type="rss" xmlUrl="https://example.com/feed.xml"/>
        </outline>
    </body>
</opml>
XML;

        $file = UploadedFile::fake()->createWithContent('malicious.opml', $maliciousOpml);

        $this->actingAs($user);

        // The import should fail because LIBXML_NONET blocks network access
        // This is the expected secure behavior - the attack is blocked
        $this->expectException(\Exception::class);
        $this->expectExceptionMessage('Unable to parse OPML file');

        $this->withoutExceptionHandling()->post(route('import.store'), [
            'opml_file' => $file,
        ]);
    }

    public function test_xxe_local_file_read_is_blocked(): void
    {
        $user = User::factory()->create();

        // Create a malicious OPML file attempting to read local files
        $maliciousOpml = <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE opml [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<opml version="1.0">
    <head>
        <title>Malicious OPML</title>
    </head>
    <body>
        <outline text="Test Category">
            <outline text="Test Feed" title="&xxe;" type="rss" xmlUrl="https://example.com/feed.xml"/>
        </outline>
    </body>
</opml>
XML;

        $file = UploadedFile::fake()->createWithContent('malicious.opml', $maliciousOpml);

        $this->actingAs($user);

        // The import should fail - external entities are blocked
        // This prevents local file disclosure attacks
        $this->expectException(\Exception::class);
        $this->expectExceptionMessage('Unable to parse OPML file');

        $this->withoutExceptionHandling()->post(route('import.store'), [
            'opml_file' => $file,
        ]);
    }

    public function test_valid_opml_parses_correctly(): void
    {
        // Test that valid OPML can be parsed with our secure settings
        $validOpml = <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<opml version="1.0">
    <head>
        <title>My Feeds</title>
    </head>
    <body>
        <outline text="Tech">
            <outline text="Example Blog" title="Example Blog" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
        </outline>
    </body>
</opml>
XML;

        // Use the same parsing approach as ImportOPML
        $previousUseErrors = libxml_use_internal_errors(true);
        $xml = simplexml_load_string($validOpml, 'SimpleXMLElement', LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previousUseErrors);

        $this->assertNotFalse($xml);
        $this->assertSame('My Feeds', (string) $xml->head->title);
        $this->assertSame('Tech', (string) $xml->body->outline['text']);
        $this->assertSame('Example Blog', (string) $xml->body->outline->outline['title']);
        $this->assertSame('https://example.com/feed.xml', (string) $xml->body->outline->outline['xmlUrl']);
    }

    public function test_import_fails_without_file(): void
    {
        $user = User::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('import.store'), []);

        $response->assertSessionHasErrors(['opml_file']);
    }

    public function test_import_fails_with_invalid_xml(): void
    {
        $user = User::factory()->create();

        $invalidXml = 'this is not valid xml <>';

        $file = UploadedFile::fake()->createWithContent('invalid.opml', $invalidXml);

        $this->actingAs($user);

        $this->expectException(\Exception::class);
        $this->expectExceptionMessageMatches('/Unable to parse OPML file/');

        $this->withoutExceptionHandling()->post(route('import.store'), [
            'opml_file' => $file,
        ]);
    }

    public function test_import_fails_with_invalid_file_type(): void
    {
        $user = User::factory()->create();

        $file = UploadedFile::fake()->image('photo.jpg');

        $this->actingAs($user);

        $response = $this->post(route('import.store'), [
            'opml_file' => $file,
        ]);

        $response->assertSessionHasErrors(['opml_file']);
    }
}
